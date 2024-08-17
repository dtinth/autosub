import Anthropic from "@anthropic-ai/sdk";
import fs from "fs";
import { OpenAI } from "openai";
import { LineLogger } from "./LineLogger";

const anthropic = new Anthropic({});
const openai = new OpenAI();

interface InvokeLLMOptions {
  prompt: string;
  outputPath: string;
  usagePath: string;
}

export async function invokeLLM({
  prompt,
  outputPath,
  usagePath,
}: InvokeLLMOptions) {
  const llm = process.env.LLM?.toLowerCase() || "anthropic";
  const logger = new LineLogger();
  const output = fs.createWriteStream(outputPath);
  let usage = "";

  if (llm === "anthropic") {
    console.log("Using Anthropic");
    const stream = anthropic.messages
      .stream({
        model: "claude-3-5-sonnet-20240620",
        max_tokens: 4096,
        temperature: 0,
        messages: [{ role: "user", content: [{ type: "text", text: prompt }] }],
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
    fs.writeFileSync(usagePath, JSON.stringify(message.usage, null, 2));
  } else if (llm === "openai") {
    console.log("Using OpenAI");
    const stream = await openai.chat.completions.create({
      model: "chatgpt-4o-latest",
      messages: [{ role: "user", content: prompt }],
      stream: true,
      temperature: 0,
      stream_options: { include_usage: true },
    });

    let totalUsage: OpenAI.Completions.CompletionUsage | undefined;

    for await (const chunk of stream) {
      if (chunk.choices.length === 0) {
        totalUsage = chunk.usage;
      } else {
        const content = chunk.choices[0]?.delta?.content || "";
        if (content) {
          logger.add(content, usage);
          usage = "";
          output.write(content);
        }
      }
    }

    if (totalUsage) {
      console.log("Token usage:", totalUsage);
      fs.writeFileSync(usagePath, JSON.stringify(totalUsage, null, 2));
    }
  } else {
    throw new Error(`Unsupported LLM: ${llm}`);
  }

  output.end();
  logger.finish();
}
