import Anthropic from "@anthropic-ai/sdk";
import {
  GoogleGenerativeAI,
  HarmBlockThreshold,
  HarmCategory,
} from "@google/generative-ai";
import * as csv from "csv/sync";
import fs from "fs";
import { extractTag } from "../src/extractTag";

const input = fs.readFileSync("train.tsv", "utf8");
const notes = fs.readFileSync("notes.txt", "utf8");
const trainingSet = csv.parse(input, { delimiter: "\t", relaxQuotes: true });
const stdin = (await process.stdin.toArray()).join("");

let nextTrainingCueNumber = 1;
const trainingInput: string[][] = [];
const trainingOutput: string[][] = [];
for (const row of trainingSet) {
  if (row.length === 2) {
    const cueNumber = nextTrainingCueNumber++;
    trainingInput.push([cueNumber.toString(), row[1]]);
    for (const line of row[0].split("\n")) {
      trainingOutput.push([cueNumber.toString(), line]);
    }
  }
}

const promptSet = csv.parse(stdin, { delimiter: "\t", relaxQuotes: true });
const promptInput: string[][] = [];
for (const row of promptSet) {
  if (row.length > 0) {
    promptInput.push([promptInput.length + 1, row[0]]);
  }
}

const toTsv = (data: string[][]) =>
  csv.stringify(data, { delimiter: "\t" }).trim();

let prompt = `A talk transcript is given in TSV format. Each row represents a subtitle cue.

- The first column is the cue number.
- The second column is the text spoken. It may be empty, indicating a pause in speech.

New lines may be present in the cell data, in which case, the cell is quoted with double quotes. Double quotes inside a quoted cell must be escaped with another double quote.

You are a helpful assistant. You will clean up an automatically-generated transcript, which contains many spelling errors and inconsistent spellings. Fix them and provide the fixed transcript data in <ANSWER></ANSWER> tags.`;

if (notes.trim()) {
  prompt += `

Additional notes and context for this transcript:

<NOTES>
${notes.trim()}
</NOTES>`;
}

prompt += `

Instructions for cleaning up the transcript:

- Do not change what's being said; only clean up spelling mistakes and inconsistent spellings.
- Remove filler words, but keep politeness words such as ครับ or ค่ะ. Also fix repeated words due to speaker stuttering, or speaker correcting themselves.
- Try to keep a line less than 50 characters long. If a line has more than 50 characters, you can break one line of text into multiple lines, but try to keep line lengths relatively balanced. Preferably, each line should have around 40 characters.
- When breaking a line into multiple lines, make sure that the cue number in each line of the output refers to the same cue number in the input. For example, if cue 123 is broken into 2 lines, then in the output, both lines should have 123 in the first column.
- Do not add a space before ๆ. If there is a space before ๆ in the input, remove it from the output.
- English words should not be capitalized unless it is a proper noun. English words that are not proper nouns should be converted to lowercase, except for API or code should be left alone. For example, "React" when referring to the JavaScript library should be capitalized, but "react" when referring to the action should be lowercase. "getElementById" should be left alone as it is part of a code snippet.
- English words that are transliterated into Thai should be rewritten in English. For example "สตาทิสติก" should be rewritten as "statistics", and "โมเดลที่เราเทรนมาเนี่ยมันพิคอัพแพทเทิร์นอะไร" should be rewritten into "model ที่เรา train มาเนี่ยมัน pick up pattern อะไร". However, some words such as "โปรเจค" should be retained as "โปรเจค" because it’s very often used in Thai colloquial speech that its transliteration becomes a word on its own.
- The output should be in the same format as the input. Retain the same cue number from the source input.`;

if (trainingInput.length > 0) {
  prompt += `

Example input:

<TRANSCRIPT>
${toTsv(trainingInput)}
</TRANSCRIPT>

Example output:

<ANSWER>
${toTsv(trainingOutput)}
</ANSWER>`;
}

prompt += `

Your input:

<TRANSCRIPT>
${toTsv(promptInput)}
</TRANSCRIPT>

Remember: Improve the formatting and consistency, break down long lines, fix the spelling and misrecognized words, make sure the cue numbers in the output matches the input, and provide the answer in <ANSWER></ANSWER> tags.`;

console.error(prompt);

let output = "";
if (true) {
  const anthropic = new Anthropic({});
  const stream = anthropic.messages
    .stream(
      {
        model: "claude-3-5-sonnet-20240620",
        max_tokens: 8192,
        temperature: 0,
        messages: [
          {
            role: "user",
            content: [
              {
                type: "text",
                text: prompt,
              },
            ],
          },
        ],
      },
      {
        headers: {
          "anthropic-beta": "max-tokens-3-5-sonnet-2024-07-15",
        },
      }
    )
    .on("text", (text) => {
      process.stdout.write(text);
      output += text;
    });

  const finalMessage = await stream.finalMessage();
  console.error(finalMessage.usage);
} else {
  const modelName = "gemini-1.5-pro";
  const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!);
  const model = genAI.getGenerativeModel({
    model: modelName,
    generationConfig: {
      temperature: 0,
      maxOutputTokens: 8192,
    },
    safetySettings: [
      {
        category: HarmCategory.HARM_CATEGORY_HARASSMENT,
        threshold: HarmBlockThreshold.BLOCK_NONE,
      },
      {
        category: HarmCategory.HARM_CATEGORY_HATE_SPEECH,
        threshold: HarmBlockThreshold.BLOCK_NONE,
      },
      {
        category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT,
        threshold: HarmBlockThreshold.BLOCK_NONE,
      },
      {
        category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT,
        threshold: HarmBlockThreshold.BLOCK_NONE,
      },
    ],
  });
  const result = await model.generateContentStream([{ text: prompt }]);
  for await (const chunk of result.stream) {
    const chunkText = chunk.text();
    process.stdout.write(chunkText);
    output += chunkText;
  }
  const response = await result.response;
  console.error(response.usageMetadata);
}

const answer = extractTag(output, "ANSWER");
const parsedAnswer = csv.parse(answer, { delimiter: "\t", relaxQuotes: true });
const outMap = new Map<number, string[]>();
const outTsv: string[][] = [];
for (const parsedRow of parsedAnswer) {
  if (parsedRow.length === 2) {
    const cueNumber = parseInt(parsedRow[0]);
    if (!outMap.has(cueNumber)) {
      outMap.set(cueNumber, []);
    }
    outMap.get(cueNumber)!.push(parsedRow[1]);
  }
}
let nextNumberToVerify = 1;
for (const [number, text] of outMap) {
  const expected = nextNumberToVerify++;
  if (number !== expected) {
    throw new Error(`Expected cue number ${expected}, but got ${number}`);
  }
  outTsv.push([text.join("\n")]);
}
if (outTsv.length !== promptInput.length) {
  throw new Error(
    `Expected ${promptInput.length} cues, but got ${outTsv.length}`
  );
}
console.log("-".repeat(80));
console.log(toTsv(outTsv));
