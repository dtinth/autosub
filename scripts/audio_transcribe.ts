import {
  GoogleGenerativeAI,
  HarmBlockThreshold,
  HarmCategory,
  UsageMetadata,
} from "@google/generative-ai";
import fs from "fs";
import { LineLogger } from "../src/LineLogger";
import { getPartName } from "../src/getPartName";

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!);
const partName = getPartName();

const modelName = "gemini-1.5-pro-exp-0801";
const model = genAI.getGenerativeModel({
  model: modelName,
  generationConfig: {
    temperature: 0.25,
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

let notes = "";
if (fs.existsSync("notes.txt")) {
  notes = `

The following notes should be helpful for generating the transcript more accurately:

<NOTES>
${fs.readFileSync("notes.txt", "utf8").trim()}
</NOTES>`;
}

const prompt = `Generate a transcript of the speech.

- The speech is in Thai language.
- For English words, if it is a common word, then spell it using lowercase (e.g. oscillator). If it is a proper noun, capitalize it properly (e.g. Google Chrome). If it's an API name or part of computer code, use verbatim capitalization (e.g. getElementById).
- For Thai text, do not add a space between words. Only add spaces between sentences or when there is obvious pausing.
- For technical terms, in general, spell it in English (e.g. canvas, vertex, scene). Only transliterate it to Thai if it is a very common word and commonly spelled in Thai (e.g. ลิงก์, เคส, อัพเกรด, โปรแกรมเมอร์).
- Remove filler words like "umm" and "ah". Also fix the transcript when the speaker corrects themselves or repeats themselves due to stuttering.${notes}

Remember, start a new line after each utterance or sentence, but do not break sentences into multiple lines.
`;

const result = await model.generateContentStream([
  {
    inlineData: {
      mimeType: "audio/mp3",
      data: fs.readFileSync(`artifacts/${partName}.mp3`).toString("base64"),
    },
  },
  { text: prompt },
]);

fs.writeFileSync(`artifacts/${partName}.gemini_transcript.prompt.txt`, prompt);
const out = fs.createWriteStream(`artifacts/${partName}.gemini_transcript.txt`);

const logger = new LineLogger();
let usage: UsageMetadata | undefined;
for await (const chunk of result.stream) {
  const chunkText = chunk.text();
  logger.add(
    chunkText,
    chunk.usageMetadata
      ? `${chunk.usageMetadata.promptTokenCount} in, ${chunk.usageMetadata.candidatesTokenCount} out`
      : ""
  );
  out.write(chunkText);
  process.stdout.write(".");
  usage = chunk.usageMetadata || usage;
}

out.end();
logger.finish();
fs.writeFileSync(
  `artifacts/${partName}.gemini_transcript.usage.json`,
  JSON.stringify({ ...(usage || {}), modelName }, null, 2)
);
