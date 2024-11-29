import Anthropic from "@anthropic-ai/sdk";
import fs from "fs";
import { bufferedLog } from "./bufferedLog";

const anthropic = new Anthropic({});

export async function improveTranscript(
  transcript: string,
  options: {
    log: (message: string) => void;
  }
) {
  const prompt = getPrompt(transcript);
  options.log("Prompt text:\n" + prompt);

  const stream = anthropic.messages.stream({
    model: "claude-3-5-sonnet-20241022",
    max_tokens: 8192,
    temperature: 0,
    messages: [{ role: "user", content: [{ type: "text", text: prompt }] }],
  });

  options.log("Improved Transcript:");
  let out = "";
  let usage: Anthropic.Messages.MessageDeltaUsage | undefined;
  const log = bufferedLog(options.log);

  for await (const chunk of stream) {
    if (chunk.type === "content_block_delta" && "text" in chunk.delta) {
      const chunkText = chunk.delta.text;
      out += chunkText;
      log(chunkText);
    } else if (chunk.type === "message_delta") {
      usage = chunk.usage;
    }
  }

  return { prompt, out, usage };
}

function getPrompt(transcript: string) {
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
- If a line has more than 50 characters, you can break one line of text into multiple lines, but try to keep line lengths relatively balanced. Avoid having a line with just the last word of a sentence (in this case, it should be joined with the previous line).
- English words that are transliterated into Thai should be rewritten in English. For example, "โมเดลที่เราเทรนมาเนี่ยมันพิคอัพแพทเทิร์นอะไร" should be rewritten into "model ที่เรา train มาเนี่ยมัน pick up pattern อะไร". However, some words such as "โปรเจค" should be retained as "โปรเจค" because it's very often used in Thai colloquial speech that its transliteration becomes a word on its own.
- For words that is obviously an API name or code snippet, use Mathematical Monospace unicode symbols. For example, getElementById should be 𝚐𝚎𝚝𝙴𝚕𝚎𝚖𝚎𝚗𝚝𝙱𝚢𝙸𝚍.
- For words that is obviously a variable name, use Mathematical Italic unicode symbols. For example, x should be 𝑥.
- If any mathematical equations can be formatted with unicode, please do so. For example, x^2 should be 𝑥². 2*3 can be 2×3. If the equation is too complex, you can leave it as is. Also if the equation is part of a code snippet, leave it as is.
- For English sentences, capitalize the first letter of the first word in the sentence just like in normal English sentences.
- Do not add a space before ๆ. If there is a space before ๆ in the input, remove it from the output. However, there should be a space after ๆ.
- Start a new line for each sentence, clause, or phrase. Don't join multiple sentences into one line.

Here is the transcript:
<TRANSCRIPT>
${transcript}
</TRANSCRIPT>${notes}

Provide the answer in <ANSWER> tags. Remember, break the transcript down into lines of no longer than 50 characters.`;

  return prompt;
}
