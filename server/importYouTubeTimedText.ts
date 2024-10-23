import { WordTimestamp, WordTimestamps } from "./WordTimestamps";

interface YouTubeTimedText {
  events: YouTubeTimedTextEvent[];
}

interface YouTubeTimedTextEvent {
  tStartMs: number;
  dDurationMs: number;
  segs?: YouTubeTimedTextSegment[];
}

interface YouTubeTimedTextSegment {
  utf8: string;
  tOffsetMs?: number;
}

export function importYouTubeTimedText(yt: YouTubeTimedText): WordTimestamps {
  const results: WordTimestamps["words"] = [];
  let last: WordTimestamp | undefined;

  for (const { tStartMs, dDurationMs, segs } of yt.events) {
    for (const { utf8, tOffsetMs = 0 } of segs ?? []) {
      if (!utf8 || !utf8.trim()) continue;
      const time = (tStartMs + tOffsetMs) / 1000;
      if (last && last.end > time) {
        last.end = time;
      }

      // Assume 150 words per minute and 5 characters per word
      const minSpeedCps = (150 / 60) * 5;
      const maxDuration = utf8.length / minSpeedCps;

      const item: WordTimestamp = {
        start: time,
        end: time + maxDuration,
        word: utf8,
      };
      last = item;
      results.push(item);
    }
  }

  return { words: results };
}
