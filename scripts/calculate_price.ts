import fs from "fs";

function runIfExists<T>(name: string, callback: (data: T) => void) {
  if (fs.existsSync(name)) {
    const raw = fs.readFileSync(name, "utf8");
    const data = JSON.parse(raw) as T;
    callback(data);
  }
}

interface ClaudeOrOpenAIUsage {
  // Claude
  input_tokens: number;
  output_tokens: number;

  // OpenAI
  prompt_tokens: number;
  completion_tokens: number;
}
interface GeminiUsage {
  promptTokenCount: number;
  candidatesTokenCount: number;
  modelName: string;
}

const parts = JSON.parse(fs.readFileSync("artifacts/parts.json", "utf8"));
const geminiFlash = { input: 0, output: 0 };
const geminiPro = { input: 0, output: 0 };
const claude = { input: 0, output: 0 };
const openai = { input: 0, output: 0 };

const countGemini = (usage: GeminiUsage) => {
  if (usage.modelName === "gemini-1.5-flash") {
    geminiFlash.input += usage.promptTokenCount;
    geminiFlash.output += usage.candidatesTokenCount;
  } else {
    geminiPro.input += usage.promptTokenCount;
    geminiPro.output += usage.candidatesTokenCount;
  }
};
const countClaudeOrOpenAI = (usage: ClaudeOrOpenAIUsage) => {
  claude.input += usage.input_tokens || 0;
  claude.output += usage.output_tokens || 0;
  openai.input += usage.prompt_tokens || 0;
  openai.output += usage.completion_tokens || 0;
};

for (const { name: partName } of parts) {
  runIfExists(
    `artifacts/${partName}.gemini_transcript.usage.json`,
    countGemini
  );
  runIfExists(
    `artifacts/${partName}.gemini_video_transcript.usage.json`,
    countGemini
  );
  runIfExists(
    `artifacts/${partName}.improved_transcript.usage.json`,
    countClaudeOrOpenAI
  );
  runIfExists(
    `artifacts/${partName}.alignment.usage.json`,
    countClaudeOrOpenAI
  );
}

const usdToThb = 37;
const lineItems: { name: string; tokens: number; cost: number }[] = [];

lineItems.push({
  name: "Gemini Pro input",
  tokens: geminiPro.input,
  cost: (geminiPro.input / 1e6) * 3.5 * usdToThb,
});
lineItems.push({
  name: "Gemini Pro output",
  tokens: geminiPro.output,
  cost: (geminiPro.output / 1e6) * 10.5 * usdToThb,
});
lineItems.push({
  name: "Gemini Flash input",
  tokens: geminiFlash.input,
  cost: (geminiFlash.input / 1e6) * 0.35 * usdToThb,
});
lineItems.push({
  name: "Gemini Flash output",
  tokens: geminiFlash.output,
  cost: (geminiFlash.output / 1e6) * 1.05 * usdToThb,
});
lineItems.push({
  name: "Claude input",
  tokens: claude.input,
  cost: (claude.input / 1e6) * 3 * usdToThb,
});
lineItems.push({
  name: "Claude output",
  tokens: claude.output,
  cost: (claude.output / 1e6) * 15 * usdToThb,
});
lineItems.push({
  name: "OpenAI input",
  tokens: openai.input,
  cost: (openai.input / 1e6) * 5 * usdToThb,
});
lineItems.push({
  name: "OpenAI output",
  tokens: openai.output,
  cost: (openai.output / 1e6) * 15 * usdToThb,
});

console.table([
  ...lineItems,
  {
    name: "Total",
    tokens: "-",
    cost: lineItems.reduce((acc, item) => acc + item.cost, 0),
  },
]);
