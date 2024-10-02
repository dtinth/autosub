import { SpeechmaticsASRResult } from "./SpeechmaticsASRResult";

export interface WordTimestamp {
  word: string;
  start: number;
  end: number;
}

export interface WordTimestamps {
  words: WordTimestamp[];
}

export function generateWordTimestampsFromSpeechmatics(
  asrResult: SpeechmaticsASRResult
): WordTimestamps {
  return {
    words: asrResult.results.map((x) => ({
      word: x.alternatives[0].content,
      start: x.start_time,
      end: x.end_time,
    })) as WordTimestamp[],
  };
}
