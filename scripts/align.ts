import Anthropic from "@anthropic-ai/sdk";
import fs from "fs";
import { LineLogger } from "../src/LineLogger";
import { getPartName } from "../src/getPartName";

const parts = JSON.parse(fs.readFileSync("artifacts/parts.json", "utf8"));
const partName = getPartName();
const part = parts.find((part) => part.name === partName);
if (!part) {
  throw new Error(`Part not found: ${partName}`);
}

function extractTag(text: string, tag: string) {
  const start = text.indexOf(`<${tag}>`);
  const end = text.indexOf(`</${tag}>`, start + 1);
  if (start === -1 || end === -1) {
    throw new Error(`Tag not found: ${tag}`);
  }
  return text.slice(start + tag.length + 2, end).trim();
}

let nextLineNumber = 1;
const transcript = extractTag(
  fs.readFileSync(`artifacts/${partName}.claude_transcript.txt`, "utf8"),
  "ANSWER"
)
  .split(/\r\n|\r|\n/)
  .map((line) => {
    if (line.trim() === "") {
      return { text: line };
    }
    return { lineNumber: nextLineNumber++, text: line };
  });

// const asr = JSON.parse(
//   fs.readFileSync(`artifacts/${name}.google_asr.json`, "utf8")
// );
// const asrLines: string[] = [];
// for (const result of asr.results) {
//   const best = result.alternatives[0];
//   let lastTime = "";
//   const out: string[] = [];
//   for (const word of best.words) {
//     const start = parseFloat(word.startOffset || "0").toFixed(1);
//     const end = parseFloat(word.endOffset).toFixed(1);
//     const text = word.word;
//     if (start !== lastTime) {
//       out.push(`<${start}>`);
//     }
//     out.push(text.replace(/^▁/, ""));
//     out.push(`<${end}>`);
//     lastTime = end;
//   }
//   asrLines.push(out.join(""));
// }

// const asr = JSON.parse(
//   fs.readFileSync(`artifacts/${partName}.amazon_asr.json`, "utf8")
// );
// let lastTime = "";
// const out: string[] = [];
// for (const item of asr.results.items) {
//   const start = parseFloat(item.start_time).toFixed(1);
//   const end = parseFloat(item.end_time).toFixed(1);
//   const text = item.alternatives[0].content;
//   if (start !== lastTime) {
//     out.push(`<${start}>`);
//   }
//   out.push(text.replace(/^▁/, ""));
//   out.push(`<${end}>`);
//   lastTime = end;
// }
// // console.log(out);
// // process.exit(0);
// const asrLines = [out.join("")];

const asr = JSON.parse(
  fs.readFileSync(`artifacts/speechmatics_asr.json`, "utf8")
);

interface Result {
  start_time: number;
  end_time: number;
  alternatives: { content: string }[];
}

const results = (asr.results as Result[]).filter((r) => {
  return r.start_time >= part.start && r.end_time <= part.end;
});
let lastTime = "";
const out: string[] = [];
for (const result of results) {
  const best = result.alternatives[0];
  const start = result.start_time.toFixed(1);
  const end = result.end_time.toFixed(1);
  if (start !== lastTime) {
    out.push(`<${start}>`);
  }
  out.push(best.content);
  out.push(`<${end}>`);
  lastTime = end;
}
// console.log(out);
// process.exit(0);
const asrLines = [out.join("")];

const prompt = `You are tasked with performing forced alignment between ASR (Automatic Speech Recognition) output (which is inaccurate) and a correct transcript (which does not have timing information). Your goal is to determine the appropriate start and end timecodes for each line in the transcript.

You will be provided with two inputs:

<ASR_OUTPUT>
{{ASR_OUTPUT}}
</ASR_OUTPUT>

<TRANSCRIPT>
{{TRANSCRIPT}}
</TRANSCRIPT>

The ASR output contains text mixed with timecodes in angle brackets. The format is: <timecode>text<timecode>text... where timecodes are in seconds.

The transcript contains the correct text without timing information. The format is: line number, text.

Output the results in the following format: source line number, start timecode, text, end timecode.

If a source line contains more than 50 characters, you can break it into 2 lines (keeping the same source line number), but try to keep both line lengths relatively balanced.

Important notes:
- Round timecodes to one decimal place.
- Sometimes the start and end of the transcript line are not aligned with ASR word boundaries. In this case, you should estimate the timecodes by interpolating between the surrounding words' timecodes.
- Make sure that the timecode is in STRICTLY increasing order, and that the start timecode comes BEFORE the end timecode.

Provide your answer within <ANSWER></ANSWER> tags.`;
const anthropic = new Anthropic({});

// fs.writeFileSync(
//   `artifacts/${partName}.alignment_input.json`,
//   "[" + transcript.map((line) => JSON.stringify(line)).join("\n,") + "\n]"
// );

const promptText = prompt
  .replace("{{ASR_OUTPUT}}", asrLines.join("\n"))
  .replace(
    "{{TRANSCRIPT}}",
    transcript
      .filter((line) => line.lineNumber)
      .map((line) => `${line.lineNumber}, ${line.text}`)
      .join("\n")
  );

fs.writeFileSync(`artifacts/${partName}.alignment.prompt.txt`, promptText);

const logger = new LineLogger();
const output = fs.createWriteStream(`artifacts/${partName}.alignment.txt`);
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
            text: promptText,
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
logger.finish();
output.end();
fs.writeFileSync(
  `artifacts/${partName}.alignment.usage.json`,
  JSON.stringify(message.usage, null, 2)
);
