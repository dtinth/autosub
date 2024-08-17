import fs from "fs";
interface InputWord {
  word: string;
  startTime: number;
  endTime: number;
  confidence: number;
}

interface InputTranscript {
  transcript: string;
  startTime: number;
  endTime: number;
  wordTimestamps: InputWord[];
}

interface InputJSON {
  type: string;
  amount: number;
  output: {
    results: InputTranscript[];
  };
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

  input.output.results.forEach((transcript) => {
    transcript.wordTimestamps.forEach((word) => {
      const outputResult: OutputResult = {
        alternatives: [{ content: word.word }],
        end_time: word.endTime,
        start_time: word.startTime,
      };
      output.results.push(outputResult);
    });
  });

  return output;
}

const input = JSON.parse(
  fs.readFileSync("artifacts/gowajee_asr.json", "utf8")
) as InputJSON;
const output = translateJSON(input);
fs.writeFileSync(
  "artifacts/speechmatics_asr.json",
  JSON.stringify(output, null, "\t")
);
