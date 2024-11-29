import {
  GoogleGenerativeAI,
  HarmBlockThreshold,
  HarmCategory,
  UsageMetadata,
} from "@google/generative-ai";
import fs from "fs";
import { bufferedLog } from "./bufferedLog";

export async function transcribeWithGemini(
  inPath: string,
  options: {
    log: (message: string) => void;
  }
) {
  const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!);
  const model = genAI.getGenerativeModel({
    model: "gemini-1.5-pro-002",
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

  const base64str = fs.readFileSync(inPath, "base64");
  const prompt = getPrompt();
  options.log("Prompt text:\n" + prompt);

  const result = await model.generateContentStream([
    {
      inlineData: {
        mimeType: "audio/mp3",
        data: base64str,
      },
    },
    { text: prompt },
  ]);

  options.log("Transcription:");
  let out = "";
  let usage: UsageMetadata | undefined;
  const log = bufferedLog(options.log);
  for await (const chunk of result.stream) {
    const chunkText = chunk.text();
    out += chunkText;
    log(chunkText);
    usage = chunk.usageMetadata || usage;
  }

  return { prompt, out, usage };
}

function getPrompt() {
  let notes = "";
  if (fs.existsSync("notes.txt")) {
    notes = `

The following notes should be helpful for generating the transcript more accurately:

<NOTES>
${fs.readFileSync("notes.txt", "utf8").trim()}
</NOTES>`;
  }

  const prompt = `Generate a transcript of the speech in its original language.

- For English words, if it is a common word, then spell it using lowercase (e.g. oscillator). If it is a proper noun, capitalize it properly (e.g. Google Chrome). If it's an API name or part of computer code, use verbatim capitalization (e.g. getElementById).
- For Thai text, do not add a space between words. Only add spaces between sentences or when there is obvious pausing.
- For technical terms, in general, spell it in English (e.g. canvas, vertex, scene). Only transliterate it to Thai if it is a very common word and commonly spelled in Thai (e.g. ลิงก์, เคส, อัพเกรด, โปรแกรมเมอร์).
- Remove filler words like "umm" and "ah". Also fix the transcript when the speaker corrects themselves or repeats themselves due to stuttering.${notes}

Remember, start a new line after each utterance or sentence, but do not break sentences into multiple lines.
`;
  return prompt;
}
