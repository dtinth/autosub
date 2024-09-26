import fs from "fs";
interface InputJSON {
  output: {
    text: string;
    speaker: string;
    start: number;
    end: number;
    segment: number;
  }[];
}

interface OutputAlternative {
  content: string;
}

interface OutputResult {
  alternatives: OutputAlternative[];
  end_time: number;
  start_time: number;
}

interface OutputJSON {
  results: OutputResult[];
}

function translateJSON(input: InputJSON): OutputJSON {
  const output: OutputJSON = { results: [] };

  input.output.forEach((transcript) => {
    const outputResult: OutputResult = {
      alternatives: [{ content: transcript.text }],
      end_time: transcript.start,
      start_time: transcript.end,
    };
    output.results.push(outputResult);
  });

  return output;
}

const input = JSON.parse(
  fs.readFileSync("artifacts/iapp_asr.json", "utf8")
) as InputJSON;
const output = translateJSON(input);
fs.writeFileSync(
  "artifacts/speechmatics_asr.json",
  JSON.stringify(output, null, "\t")
);
