import fs from "fs";
import { extractTag } from "../src/extractTag";
import { getPartName } from "../src/getPartName";
import { invokeLLM } from "../src/invokeLLM";

const parts = JSON.parse(fs.readFileSync("artifacts/parts.json", "utf8"));
const partName = getPartName();
const part = parts.find((part) => part.name === partName);
if (!part) {
  throw new Error(`Part not found: ${partName}`);
}

let nextLineNumber = 1;
const transcript = extractTag(
  fs.existsSync(`artifacts/${partName}.improved_fixed_transcript.txt`)
    ? fs.readFileSync(
        `artifacts/${partName}.improved_fixed_transcript.txt`,
        "utf8"
      )
    : fs.readFileSync(`artifacts/${partName}.improved_transcript.txt`, "utf8"),
  "ANSWER"
)
  .split(/\r\n|\r|\n/)
  .map((line) => {
    if (line.trim() === "") {
      return { text: line };
    }
    return { lineNumber: nextLineNumber++, text: line };
  });

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

function preprocess(line: string) {
  // remove space before ๆ
  line = line.replace(/(\S) ๆ/g, "$1ๆ");

  // add space after ๆ
  line = line.replace(/ๆ(\S)/g, "ๆ $1");

  return line;
}

const promptText = prompt
  .replace("{{ASR_OUTPUT}}", asrLines.join("\n"))
  .replace(
    "{{TRANSCRIPT}}",
    transcript
      .filter((line) => line.lineNumber)
      .map((line) => `${line.lineNumber}, ${preprocess(line.text)}`)
      .join("\n")
  );

fs.writeFileSync(`artifacts/${partName}.alignment.prompt.txt`, promptText);

await invokeLLM({
  prompt: promptText,
  outputPath: `artifacts/${partName}.alignment.txt`,
  usagePath: `artifacts/${partName}.alignment.usage.json`,
});
