import {
  GoogleGenerativeAI,
  HarmBlockThreshold,
  HarmCategory,
  SchemaType,
  type GenerationConfig,
  type Part,
  type UsageMetadata,
} from "@google/generative-ai";
import { $ } from "bun";
import { IncompleteJsonParser } from "incomplete-json-parser";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import pLimit from "p-limit";
import { ref } from "../src/projectStorage";
import { serializeVtt, type SubtitleCue } from "../src/vtt";

interface Segment {
  start: number;
  end: number;
}

interface Segmentation {
  segments: Segment[];
  frameSamples: number;
  sampleRate: number;
}

async function main() {
  const segmentsRef = ref<Segmentation>("segmentation");
  if (!segmentsRef.exists() || true) {
    console.log("Generating segments...");
    const segmentation = generateSegmentation();
    segmentsRef.set(segmentation);
  }

  const segmentation = segmentsRef.get()!;
  const duration = (segment: Segment) => {
    return (
      ((segment.end - segment.start) * segmentation.frameSamples) /
      segmentation.sampleRate
    );
  };
  const timeSeconds = (frame: number) => {
    return (frame * segmentation.frameSamples) / segmentation.sampleRate;
  };
  const timecode = (frame: number) => {
    const ts = timeSeconds(frame);
    const hours = Math.floor(ts / 3600);
    const minutes = Math.floor((ts % 3600) / 60);
    const seconds = Math.floor(ts % 60);
    const milliseconds = Math.floor((ts % 1) * 1000);
    return [
      hours.toString().padStart(2, "0"),
      ":",
      minutes.toString().padStart(2, "0"),
      ":",
      seconds.toString().padStart(2, "0"),
      ".",
      milliseconds.toString().padStart(3, "0"),
    ].join("");
  };

  const segmentKey = (segment: Segment) =>
    `${timecode(segment.start)}-${timecode(segment.end)}`;

  for (const segment of segmentation.segments) {
    console.log(
      `Segment:`,
      timecode(segment.start),
      "-->",
      timecode(segment.end),
      `(${duration(segment).toFixed(1)}s)`
    );
  }

  const segmentTranscriptionRef = (segment: Segment) =>
    ref<{ text: string }>(`transcription:${segmentKey(segment)}`);

  const limit = pLimit(4);
  const segmentMp3 = async (segment: Segment) => {
    return limit(async () => {
      // Find a previous index
      const index = segmentation.segments.indexOf(segment);
      const previousSegment =
        index > 0 ? segmentation.segments[index - 1] : null;

      const start = timecode(
        Math.max(
          0,
          segment.start - 8,
          ...(previousSegment ? [previousSegment.end] : [])
        )
      );
      const end = timecode(segment.end);
      const key =
        start.replaceAll(/\W/g, "-") + "__" + (segment.end - segment.start);
      const outFile = "segments/" + key + ".mp3";
      if (!existsSync(outFile)) {
        mkdirSync("segments", { recursive: true });
        await $`ffmpeg -i audio.mp3 -ss ${start} -to ${end} -c copy ${outFile} -y`;
      }
      return readFileSync(outFile, "base64");
    });
  };

  const transcribe = async () => {
    const prior: string[] = [];
    const toTranscribe: Segment[] = [];
    let totalDuration = 0;
    for (const segment of segmentation.segments) {
      const transcriptionRef = segmentTranscriptionRef(segment);
      if (transcriptionRef.exists()) {
        prior.push(transcriptionRef.get()!.text);
        continue;
      }
      toTranscribe.push(segment);
      totalDuration += duration(segment);
      if (totalDuration > 180) break;
    }
    if (!toTranscribe.length) {
      return { continue: false, message: "No segments to transcribe" };
    }
    const audios = await Promise.all(
      toTranscribe.map(async (segment) => {
        return {
          segment,
          mp3: await segmentMp3(segment),
        };
      })
    );
    const result = await processAudio(
      audios.map((a) => a.mp3),
      []
    );
    for (const [index, text] of result.output.entries()) {
      const segment = toTranscribe[index];
      segmentTranscriptionRef(segment).set({ text });
    }
    return { continue: true, message: "Transcribed segments" };
  };

  const generateVtt = () => {
    const cues: SubtitleCue[] = [];
    for (const segment of segmentation.segments) {
      const transcriptionRef = segmentTranscriptionRef(segment);
      if (!transcriptionRef.exists()) continue;
      const text = transcriptionRef.get()!.text;
      if (!text.trim()) continue;
      cues.push({
        text: text,
        start: timeSeconds(segment.start) * 1000,
        end: timeSeconds(segment.end) * 1000,
      });
    }
    const vtt = serializeVtt(cues);
    return vtt;
  };

  for (;;) {
    const result = await transcribe();
    console.log(result.message);
    if (!result.continue) break;
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }

  const vtt = generateVtt();
  writeFileSync("captions.vtt", vtt);
}

function generateSegmentation(): Segmentation {
  const data = JSON.parse(readFileSync("audio.vad.json", "utf8"));
  const chars = " ▁▂▃▄▅▆▇█";

  const frames = data.probs
    .split("")
    .map((c: string) => chars.indexOf(c) / (chars.length - 1));

  const duration = (segment: Segment) => {
    return ((segment.end - segment.start) * data.frameSamples) / 16000;
  };

  const combine = (a: Segment, b: Segment): Segment => {
    return { start: a.start, end: b.end };
  };

  const gapSegment = (a: Segment, b: Segment): Segment => {
    return { start: a.end, end: b.start };
  };

  /**
   * Creates a segment when probability of speech is above 0.7, and ends it when
   * the probability of speech is below 0.3.
   */
  function segment(frames: number[]): Segment[] {
    let segments: Segment[] = [];
    let start = 0;
    let isSpeech = false;
    for (let i = 0; i < frames.length; i++) {
      if (isSpeech) {
        if (frames[i] < 0.6) {
          segments.push({ start, end: i });
          isSpeech = false;
        }
      } else {
        if (frames[i] > 0.7) {
          start = i;
          isSpeech = true;
        }
      }
    }
    if (isSpeech) {
      segments.push({ start, end: frames.length });
    }

    // Only keep segments where the average probability of speech is above 0.5.
    segments = segments.filter(({ start, end }) => {
      const probs = frames.slice(start, end);
      const sum = probs.reduce((a, b) => a + b, 0);
      return sum / probs.length > 0.5;
    });

    // Split segments longer than 6 seconds.
    if (!false) {
      segments = segments.flatMap((segment) => splitIfNeeded(segment));
    }

    // Group segments together if the gap between them is small.
    for (;;) {
      const candidate = getGroupingCandidate(segments);
      if (candidate === null) break;
      segments[candidate] = combine(
        segments[candidate],
        segments[candidate + 1]
      );
      segments.splice(candidate + 1, 1);
    }
    return segments;
  }

  /**
   * Find the best candidate for grouping segments.
   * If a number is returned, then segments[i] and segments[i+1] should be grouped together.
   */
  function getGroupingCandidate(segments: Segment[]): number | null {
    const candidates: { index: number; gap: number }[] = [];
    for (let i = 0; i < segments.length - 1; i++) {
      const a = segments[i];
      const b = segments[i + 1];
      if (duration(a) > 1.5 && duration(b) > 1.5) continue;
      if (duration(combine(a, b)) > 6) continue;
      const gap = duration(gapSegment(a, b));
      if (gap > 0.5) continue;
      candidates.push({ index: i, gap });
    }
    candidates.sort((a, b) => a.gap - b.gap);
    if (candidates.length === 0) return null;
    return candidates[0].index;
  }

  function splitIfNeeded(segment: Segment): Segment[] {
    if (duration(segment) < 6) return [segment];
    const probs = frames.slice(segment.start, segment.end);
    const candidates: { index: number; prob: number }[] = [];
    const pad = Math.round((16000 * 1.5) / data.frameSamples);
    for (let i = pad; i < probs.length - pad; i++) {
      const leftFraction = i / probs.length;
      const rightFraction = 1 - leftFraction;
      const multiplier = leftFraction ** 2 + rightFraction ** 2;
      candidates.push({ index: i, prob: probs[i] * multiplier });
    }
    if (candidates.length === 0) return [segment];
    candidates.sort((a, b) => a.prob - b.prob);
    const split = candidates[0].index;
    const left: Segment = { start: segment.start, end: segment.start + split };
    const right: Segment = { start: segment.start + split, end: segment.end };
    console.log(
      "Splitting segment with duration",
      duration(segment).toFixed(1),
      "into",
      duration(left).toFixed(1),
      "and",
      duration(right).toFixed(1)
    );
    return [left, right].flatMap((segment) => splitIfNeeded(segment));
  }

  return {
    segments: segment(frames),
    frameSamples: data.frameSamples,
    sampleRate: 16000,
  };
}

export interface TranscriptionItem {
  id: string;
  transcript: string;
}
async function processAudio(mp3s: string[], prior: string[]) {
  const generationConfig: GenerationConfig = {
    maxOutputTokens: 5000,
    responseMimeType: "application/json",
    responseSchema: {
      type: SchemaType.OBJECT,
      properties: {
        transcription: {
          type: SchemaType.ARRAY,
          items: {
            type: SchemaType.OBJECT,
            properties: {
              id: { type: SchemaType.STRING },
              transcript: { type: SchemaType.STRING },
            },
          },
        },
      },
    },
  };
  const historyParts: Part[] = [
    {
      text:
        `You are a professional transcriber.

Notes for transcription:
<notes>${readFileSync("notes.txt", "utf8")}</notes>` +
        (prior.length > 0
          ? `
For your context, here are the prior transcribed texts: ${JSON.stringify(
              prior
            )}\n\n`
          : "") +
        `

You will be given a series of audio files and their IDs in this format:

id: <id>
<audio file>

Transcribe the speech in each audio file. Follow the style guide when transcribing:
- For English words, if it is a common word, then spell it using lowercase (e.g. oscillator). If it is a proper noun, capitalize it properly (e.g. Google Chrome). If it's an API name or part of computer code, use verbatim capitalization (e.g. getElementById).
- For Thai text, do not add a space between words. Only add spaces between sentences or when there is obvious pausing.
- Add spaces between Thai words and foreign words.
- For English sentences, add punctuation marks as appropriate. For example, add periods at the end of sentences (or a question mark if the speaker is asking a question), and add commas and hyphens where it should be used. Sometimes our speakers are not fluent in English, so please fix the disfluency (such as "um"'s and "uh"'s, stuttering and stammering). Also fix minor grammatical mistakes, for example, "everyone like" should be "everyone likes." (Only fix minor mistakes though!)
- For English sentences, capitalize the first word of the sentence so it is easier to read.
- For technical terms, in general, spell it in English (e.g. canvas, vertex, scene). Only transliterate it to Thai if it is a very common word and commonly spelled in Thai (e.g. ลิงก์, เคส, อัพเกรด, โปรแกรมเมอร์).
- Remove filler words like "umm" and "ah". Also fix the transcript when the speaker corrects themselves or repeats themselves due to stuttering.
- At the end of the audio file there may be beeping sound, do not include it in the transcript.
- If there is no speech, return an empty string for the transcript.

Transcribe the following audio files.`,
    },
  ];
  const apiKey = process.env["GEMINI_API_KEY"]!;
  const genAI = new GoogleGenerativeAI(apiKey);
  const model = genAI.getGenerativeModel({ model: "gemini-1.5-pro-002" });
  const chatSession = model.startChat({
    generationConfig: generationConfig,
    history: [],
    safetySettings: [
      {
        category: HarmCategory.HARM_CATEGORY_HARASSMENT,
        threshold: HarmBlockThreshold.BLOCK_NONE,
      },
      {
        category: HarmCategory.HARM_CATEGORY_HATE_SPEECH,
        threshold: HarmBlockThreshold.BLOCK_NONE,
      },
      {
        category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT,
        threshold: HarmBlockThreshold.BLOCK_NONE,
      },
      {
        category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT,
        threshold: HarmBlockThreshold.BLOCK_NONE,
      },
    ],
  });

  const promptParts: Part[] = [];
  const ids: string[] = [];
  for (const mp3 of mp3s) {
    const id = createHash("md5").update(mp3).digest("hex").slice(0, 8);
    ids.push(id);
    promptParts.push({ text: "id: " + id });
    promptParts.push({ inlineData: { mimeType: "audio/mp3", data: mp3 } });
  }

  const result = await chatSession.sendMessageStream(
    [...historyParts, ...promptParts],
    { timeout: 180000 }
  );
  let usageMetadata: UsageMetadata | undefined;
  const parser = new IncompleteJsonParser();
  let unconfirmedOutput: { id: string; transcript: string }[] = [];
  const output: string[] = [];
  let error = "";

  let loggedIndex = 0;
  let logTo = (target: number) => {
    for (; loggedIndex < target; loggedIndex++) {
      const expectedId = ids[loggedIndex];
      const actualId = unconfirmedOutput[loggedIndex].id;
      if (expectedId !== actualId) {
        throw new Error(
          `Expected ID ${expectedId} but got ${actualId} (index: ${loggedIndex})`
        );
      }
      const transcript = postProcess(unconfirmedOutput[loggedIndex].transcript);
      console.log(`[${actualId}] ${transcript}`);
      output.push(transcript);
    }
  };

  try {
    for await (const chunk of result.stream) {
      if (chunk.usageMetadata) {
        usageMetadata = chunk.usageMetadata;
      }
      parser.write(chunk.text());
      unconfirmedOutput = parser.getObjects().transcription || [];
      logTo(unconfirmedOutput.length - 1);
    }
    logTo(unconfirmedOutput.length);
  } catch (e: any) {
    console.error("[processAudio]", e);
    error = String(e?.stack || e);
  }
  return { usageMetadata, output, error, ids };
}

function postProcess(text: string) {
  return (
    text
      .replace(/ปื๊ด\s*$/, "")
      .replace(/ปื้ด\s*$/, "")
      .replace(/ปี๊บๆ+\s*$/, "")
      .replace(/ๆ(?:ๆ+)\s*$/, "ๆ")

      // Add spaces between Thai words and foreign words.
      .replace(/([ก-๙])([a-zA-Z0-9])/g, "$1 $2")
      .replace(/([a-zA-Z0-9])([ก-๙])/g, "$1 $2")

      .trim()
  );
}

await main();
