import fs from "fs";
interface InputWord {
  word: string;
  start: number;
  end: number;
  confidence: number;
}

interface InputUtterance {
  start: number;
  end: number;
  words: InputWord[];
}

interface InputJSON {
  transcription: {
    utterances: InputUtterance[];
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

  input.transcription.utterances.forEach((utterance) => {
    utterance.words.forEach((word) => {
      // Use Intl.Segmenter to break down words as Gladia word may actually be multiple words
      const segmenter = new Intl.Segmenter("th", { granularity: "word" });
      const segments = Array.from(segmenter.segment(word.word)).filter(
        (x) => x.segment.trim() && x.isWordLike
      );
      for (const [i, segment] of segments.entries()) {
        const start =
          word.start + (i / segments.length) * (word.end - word.start);
        const end =
          word.start + ((i + 1) / segments.length) * (word.end - word.start);
        const outputResult: OutputResult = {
          alternatives: [{ content: segment.segment.trim() }],
          end_time: end,
          start_time: start,
        };
        output.results.push(outputResult);
      }
    });
  });

  return output;
}

const input = JSON.parse(
  fs.readFileSync("artifacts/gladia_asr.json", "utf8")
) as InputJSON;
const output = translateJSON(input);
fs.writeFileSync(
  "artifacts/speechmatics_asr.json",
  JSON.stringify(output, null, "\t")
);
