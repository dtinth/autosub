import diffSequence from "diff-sequences";
import fs from "fs";

function parse(vtt: string) {
  const text = vtt
    .split("\n")
    .slice(2)
    .filter((x) => x.trim() && !x.includes("-->"))
    .join("\n");
  const words = Array.from(
    new Intl.Segmenter("th", { granularity: "word" }).segment(text)
  )
    .filter((x) => x.isWordLike)
    .map((x) => x.segment);
  return { vtt, text, words };
}

const a = parse(fs.readFileSync("artifacts/subtitles.vtt", "utf8"));
const b = parse(fs.readFileSync("fixed.vtt", "utf8"));

console.log("A words:", a.words.length);
console.log("B words:", b.words.length);

// @ts-ignore
let diff = diffSequence.default as typeof diffSequence;

function wer(reference: string[], hypothesis: string[]): number {
  const isCommon = (refIndex: number, hypIndex: number) =>
    reference[refIndex] === hypothesis[hypIndex];

  let commonCount = 0;
  const foundSubsequence = (nCommon: number) => {
    commonCount += nCommon;
  };

  diff(reference.length, hypothesis.length, isCommon, foundSubsequence);

  const substitutions =
    Math.max(reference.length, hypothesis.length) - commonCount;
  const insertions = Math.max(0, hypothesis.length - reference.length);
  const deletions = Math.max(0, reference.length - hypothesis.length);

  const totalErrors = substitutions + insertions + deletions;
  const totalWords = reference.length;

  return totalWords === 0 ? 1 : totalErrors / totalWords;
}

console.log("WER:", wer(b.words, a.words) * 100);
