import fs from "fs";
import { getPartName } from "../src/getPartName";
import { invokeLLM } from "../src/invokeLLM";

const partName = getPartName();

let notes = "";
if (fs.existsSync("notes.txt")) {
  notes = `

The following notes should be helpful for generating the transcript more accurately:

<NOTES>
${[
  fs.readFileSync("notes.txt", "utf8").trim(),
  fs.existsSync("improvement_notes.txt")
    ? fs.readFileSync("improvement_notes.txt", "utf8").trim()
    : "",
]
  .filter(Boolean)
  .join("\n\n")}
</NOTES>`;
}

const prompt = `Your job is to take the following transcript and improve it.

- Remove filler words, but keep politeness words such as ครับ or ค่ะ. Also fix repeated words due to speaker stuttering, or speaker correcting themselves.
- Remove markers such as "<noise>".
- English words should not be capitalized unless it is a proper noun. English words that are not proper nouns should be converted to lowercase, except for API or code (e.g. moveTo) should be left alone.
- If a line has more than 50 characters, you can break one line of text into multiple lines, but try to keep line lengths relatively balanced.
- English words that are transliterated into Thai should be rewritten in English. For example, "โมเดลที่เราเทรนมาเนี่ยมันพิคอัพแพทเทิร์นอะไร" should be rewritten into "model ที่เรา train มาเนี่ยมัน pick up pattern อะไร". However, some words such as "โปรเจค" should be retained as "โปรเจค" because it's very often used in Thai colloquial speech that its transliteration becomes a word on its own.
- If any mathematical equations can be formatted with unicode, please do so. For example, x^2 should be x². 2*3 can be 2×3. If the equation is too complex, you can leave it as is. Also if the equation is part of a code snippet, leave it as is.
- Do not add a space before ๆ. If there is a space before ๆ in the input, remove it from the output. However, there should be a space after ๆ.

Here is the transcript:
<TRANSCRIPT>
{{TRANSCRIPT}}
</TRANSCRIPT>${notes}

Provide the answer in <ANSWER> tags. Remember, break the transcript down into lines of no longer than 50 characters.`;

const input = fs.existsSync(`artifacts/${partName}.gemini_video_transcript.txt`)
  ? fs.readFileSync(`artifacts/${partName}.gemini_video_transcript.txt`, "utf8")
  : fs.readFileSync(`artifacts/${partName}.gemini_transcript.txt`, "utf8");

const promptInput = prompt.replace("{{TRANSCRIPT}}", input);
fs.writeFileSync(
  `artifacts/${partName}.improved_transcript.prompt.txt`,
  promptInput
);

await invokeLLM({
  prompt: promptInput,
  outputPath: `artifacts/${partName}.improved_transcript.txt`,
  usagePath: `artifacts/${partName}.improved_transcript.usage.json`,
});
