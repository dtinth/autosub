import diffSequences from "diff-sequences";
import { WordTimestamps } from "./WordTimestamps";

interface TranscriptWord {
  word: string;
  index: number;
  alignment?: {
    start: number;
    end: number;
    exact: boolean;
    index: number;
  };
}
interface AsrWord {
  word: string;
  start: number;
  end: number;
  index: number;
}

export async function alignTranscript(
  text: string,
  wordTimestamps: WordTimestamps,
  { log }: { log: (message: string) => void }
) {
  const rows = text
    .split("\n")
    .map((row) => row.trim())
    .filter((x) => x);
  const outputRows: { words: TranscriptWord[]; text: string }[] = [];

  // Load transcript
  const transcriptWords: TranscriptWord[] = [];
  for (const text of rows) {
    const words = toWords(text);
    const wordsThisRow: TranscriptWord[] = [];
    for (const { segment: word, index } of words) {
      const transcriptWord: TranscriptWord = { word, index };
      transcriptWords.push(transcriptWord);
      wordsThisRow.push(transcriptWord);
    }
    outputRows.push({ words: wordsThisRow, text });
  }

  // Load ASR results
  const asrWords: AsrWord[] = [];
  for (const result of wordTimestamps.words) {
    const words = toWords(result.word);
    for (const [i, { segment: word }] of words.entries()) {
      const start =
        result.start + (i / words.length) * (result.end - result.start);
      const end =
        result.start + ((i + 1) / words.length) * (result.end - result.start);
      asrWords.push({ word, start, end, index: asrWords.length });
    }
  }

  log("Words in transcript: " + transcriptWords.length);
  log("Words in ASR: " + asrWords.length);

  // Perform diffing between the two to find common words
  const groups: {
    aligned: boolean;
    fromTranscript: (typeof transcriptWords)[number][];
    fromAsr: (typeof asrWords)[number][];
  }[] = [];
  let lastTranscriptIndex = 0;
  let lastAsrIndex = 0;
  diffSequences(
    transcriptWords.length,
    asrWords.length,
    (i, j) =>
      transcriptWords[i].word.localeCompare(asrWords[j].word, ["en", "th"], {
        sensitivity: "base",
      }) === 0,
    (nCommon, tIndex, aIndex) => {
      groups.push({
        aligned: false,
        fromTranscript: transcriptWords.slice(lastTranscriptIndex, tIndex),
        fromAsr: asrWords.slice(lastAsrIndex, aIndex),
      });
      groups.push({
        aligned: true,
        fromTranscript: transcriptWords.slice(tIndex, tIndex + nCommon),
        fromAsr: asrWords.slice(aIndex, aIndex + nCommon),
      });
      lastTranscriptIndex = tIndex + nCommon;
      lastAsrIndex = aIndex + nCommon;
    }
  );

  // Interpolate the remaining words
  for (const [groupIndex, group] of groups.entries()) {
    if (!group.fromAsr.length) {
      const previousGroup = groups[groupIndex - 1];
      const nextGroup = groups[groupIndex + 1];
      const lastWord = previousGroup?.fromAsr.slice(-1)[0];
      const previousGroupEndTime = lastWord?.end;
      const nextGroupStartTime = nextGroup?.fromAsr[0]?.start;
      if (!previousGroupEndTime || !nextGroupStartTime) continue;

      // Naively interpolate the timing into the transcript, for lack of a better method
      const groupStart = previousGroupEndTime;
      const groupDuration = nextGroupStartTime - groupStart;
      for (const [i, word] of group.fromTranscript.entries()) {
        const start =
          groupStart + (i / group.fromTranscript.length) * groupDuration;
        const end =
          groupStart + ((i + 1) / group.fromTranscript.length) * groupDuration;
        word.alignment = {
          start,
          end,
          exact: group.aligned,
          index: lastWord.index,
        };
      }

      continue;
    }
    const resolveTime = (t: number) => {
      // t is a fraction of the way through the group, from 0 to group.fromAsr.length
      const index = Math.min(Math.floor(t), group.fromAsr.length - 1);
      const fraction = t - index;
      return {
        time:
          group.fromAsr[index].start +
          fraction * (group.fromAsr[index].end - group.fromAsr[index].start),
        index: group.fromAsr[index].index,
      };
    };
    // Interpolate the timing from ASR into the transcript.
    for (const [i, word] of group.fromTranscript.entries()) {
      const scaledStart =
        (i * group.fromAsr.length) / group.fromTranscript.length;
      const scaledQuarter =
        ((i + 0.25) * group.fromAsr.length) / group.fromTranscript.length;
      const { time: start, index } = resolveTime(scaledStart);
      const { time: quarter } = resolveTime(scaledQuarter);
      const duration = (quarter - start) * 4;
      word.alignment = {
        start,
        end: start + duration,
        exact: group.aligned,
        index,
      };
    }
  }
  log("Aligned.");
  return { outputRows, asrWords };
}

const toWords = (text: string) =>
  Array.from(
    new Intl.Segmenter("th", { granularity: "word" }).segment(text)
  ).filter((s) => s.isWordLike);
