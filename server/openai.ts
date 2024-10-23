import fs from "fs";
import OpenAI from "openai";
import { bufferedLog } from "./bufferedLog";

export async function transcribeWithOpenAI(
  inPath: string,
  options: {
    log: (message: string) => void;
  }
) {
  const openai = new OpenAI();
  const base64str = fs.readFileSync(inPath, "base64");
  const response = await openai.chat.completions.create({
    model: "gpt-4o-audio-preview",
    modalities: ["text"],
    messages: [
      {
        role: "user",
        content: [
          {
            type: "text",
            text: `Transcribe the following audio.

Follow the style guide when transcribing:
- For English words, if it is a common word, then spell it using lowercase (e.g. oscillator). If it is a proper noun, capitalize it properly (e.g. Google Chrome). If it's an API name or part of computer code, use verbatim capitalization (e.g. getElementById).
- For Thai text, do not add a space between words. Only add spaces between sentences or when there is obvious pausing.
- Add spaces between Thai words and foreign words.
- For English sentences, add punctuation marks as appropriate. For example, add periods at the end of sentences (or a question mark if the speaker is asking a question), and add commas and hyphens where it should be used. Sometimes our speakers are not fluent in English, so please fix the disfluency (such as "um"'s and "uh"'s, stuttering and stammering). Also fix minor grammatical mistakes, for example, "everyone like" should be "everyone likes." (Only fix minor mistakes though!)
- For English sentences, capitalize the first word of the sentence so it is easier to read.
- For technical terms, in general, spell it in English (e.g. canvas, vertex, scene). Only transliterate it to Thai if it is a very common word and commonly spelled in Thai (e.g. ลิงก์, เคส, อัพเกรด, โปรแกรมเมอร์).
- Remove filler words like "umm" and "ah". Also fix the transcript when the speaker corrects themselves or repeats themselves due to stuttering.
- Each sentence should be on a separate line. That is, start a new line after each sentence or phrase.
- If a sentence has more than fifteen (15) words, split it into multiple lines, but keep the line lengths relatively balanced.

Present the transcription inside a <TRANSCRIPT> tag.`,
          },
          {
            type: "input_audio",
            input_audio: { data: base64str, format: "mp3" },
          },
        ],
      },
    ],
    stream: true,
  });

  options.log("Transcription:");
  const log = bufferedLog(options.log);
  let out = "";
  for await (const chunk of response) {
    if (chunk.choices[0]?.delta?.content) {
      const chunkText = chunk.choices[0].delta.content;
      out += chunkText;
      log(chunkText);
    }
  }
  return { out };
}
