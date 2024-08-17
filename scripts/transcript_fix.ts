import Anthropic from "@anthropic-ai/sdk";
import cp from "child_process";
import fs from "fs";
import { LineLogger } from "../src/LineLogger";
import { extractTag } from "../src/extractTag";
import { getPartName } from "../src/getPartName";

const anthropic = new Anthropic({});
const partName = getPartName();

let notes = "";
if (fs.existsSync("notes.txt")) {
  notes = `

The following notes should be helpful for generating the transcript more accurately:

<NOTES>
${fs.readFileSync("notes.txt", "utf8").trim()}
</NOTES>`;
}

const prompt = `Your job is to take the following transcript and fix mistakes improve it.

- Remove filler words, but keep politeness words such as ครับ or ค่ะ. Also fix repeated words due to speaker stuttering, or speaker correcting themselves.
- English words should not be capitalized unless it is a proper noun. English words that are not proper nouns should be converted to lowercase, except for API or code (e.g. moveTo) should be left alone.
- If a line has more than 50 characters, you can break one line of text into multiple lines, but try to keep line lengths relatively balanced.
- English words that are transliterated into Thai should be rewritten in English. For example, "โมเดลที่เราเทรนมาเนี่ยมันพิคอัพแพทเทิร์นอะไร" should be rewritten into "model ที่เรา train มาเนี่ยมัน pick up pattern อะไร". However, some words such as "โปรเจค" should be retained as "โปรเจค" because it’s very often used in Thai colloquial speech that its transliteration becomes a word on its own.
- If any mathematical equations can be formatted with unicode, please do so. For example, x^2 should be x². 2*3 can be 2×3. If the equation is too complex, you can leave it as is. Also if the equation is part of a code snippet, leave it as is.
- Do not add a space before ๆ. If there is a space before ๆ in the input, remove it from the output. However, there should be a space after ๆ.
${notes}

Provide the answer in <ANSWER> tags.

Example input:
<TRANSCRIPT>
{{EXAMPLE_TRANSCRIPT}}
</TRANSCRIPT>

Example output:
<ANSWER>
{{EXAMPLE_ANSWER}}
</ANSWER>

Here is the transcript:
<TRANSCRIPT>
{{TRANSCRIPT}}
</TRANSCRIPT>

`;

const exampleInputs: string[] = [];
const exampleOutputs: string[] = [];

const parts = JSON.parse(fs.readFileSync("artifacts/parts.json", "utf8")) as {
  name: string;
}[];
const index = parts.findIndex((part) => part.name === partName);
for (let i = 0; i < index; i++) {
  exampleInputs.push(
    extractTag(
      fs.readFileSync(
        `artifacts/${parts[i].name}.improved_transcript.txt`,
        "utf8"
      ),
      "ANSWER"
    )
  );
  exampleOutputs.push(
    extractTag(
      fs.readFileSync(
        `artifacts/${parts[i].name}.improved_fixed_transcript.txt`,
        "utf8"
      ),
      "ANSWER"
    )
  );
}

const input = extractTag(
  fs.readFileSync(`artifacts/${partName}.improved_transcript.txt`, "utf8"),
  "ANSWER"
);

const logger = new LineLogger();
if (fs.existsSync(`artifacts/${partName}.improved_fixed_transcript.txt`)) {
  console.error("Output file already exists. Please delete it first.");
  process.exit(1);
}
const output = fs.createWriteStream(
  `artifacts/${partName}.improved_fixed_transcript.txt`
);
const promptInput = prompt
  .replace("{{EXAMPLE_TRANSCRIPT}}", exampleInputs.join("\n\n"))
  .replace("{{EXAMPLE_ANSWER}}", exampleOutputs.join("\n\n"))
  .replace("{{TRANSCRIPT}}", input);
fs.writeFileSync(
  `artifacts/${partName}.improved_fixed_transcript.prompt.txt`,
  promptInput
);

let usage = "";
const stream = anthropic.messages
  .stream({
    model: "claude-3-5-sonnet-20240620",
    max_tokens: 4096,
    temperature: 0,
    messages: [
      {
        role: "user",
        content: [
          {
            type: "text",
            text: promptInput,
          },
        ],
      },
    ],
  })
  .on("text", (text) => {
    logger.add(text, usage);
    usage = "";
    output.write(text);
  });

const finalMessagePromise = stream.finalMessage();

for await (const chunk of stream) {
  if (chunk.type === "message_delta") {
    usage = `${chunk.usage.output_tokens} out`;
  }
}

const message = await finalMessagePromise;
console.log(message.usage);
output.end();
fs.writeFileSync(
  `artifacts/${partName}.improved_fixed_transcript.usage.json`,
  JSON.stringify(message.usage, null, 2)
);

// Display diff
cp.spawnSync(
  `diff -u artifacts/${partName}.improved_transcript.txt artifacts/${partName}.improved_fixed_transcript.txt`,
  { stdio: "inherit", shell: true }
);
