import { NonRealTimeVAD } from "@ricky0123/vad-web";
import { execFileSync } from "node:child_process";
import fs, { writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";

// Number of samples per frame
const frameSamples = 512;

// Path to the source audio file
const audioPath = "audio.mp3";

// Path to the converted audio file
const f32Path = "audio.f32";

// Path to the VAD result file
const vadResultPath = "audio.vad.json";

// Convert audio to 16kHz 32-bit float PCM
if (!fs.existsSync(f32Path)) {
  console.log("Converting audio to 16kHz 32-bit float PCM...");
  execFileSync(
    "ffmpeg",
    [
      "-i",
      audioPath,
      "-f",
      "f32le",
      "-acodec",
      "pcm_f32le",
      "-ar",
      "16000",
      "-ac",
      "1",
      "-y",
      f32Path,
    ],
    { encoding: "buffer", stdio: ["ignore", "pipe", "inherit"] }
  );
}

// Load the audio file
const f32Buffer = fs.readFileSync(f32Path);
const f32Array = new Float32Array(
  f32Buffer.buffer,
  f32Buffer.byteOffset,
  f32Buffer.byteLength / 4
);
const frameCount = Math.floor(f32Array.length / frameSamples);
console.log("PCM buffer length:", f32Buffer.length);
console.log("Number of samples:", f32Array.length);
console.log("Audio duration:", (f32Array.length / 16000).toFixed(1), "seconds");
console.log("Samples per frame:", frameSamples);
console.log("Number of frames:", frameCount);

// Construct a new VAD instance
const vad = await NonRealTimeVAD.new({
  modelFetcher: async (path: string) => {
    const require = createRequire(import.meta.url);
    const modelPath = require.resolve(join("@ricky0123/vad-web/dist", path));
    console.log("Loading model from", modelPath);
    const contents = fs.readFileSync(modelPath);
    return contents.buffer as ArrayBuffer;
  },
  frameSamples,
});

// Obtain the low-level frame processor
const frameProcessor = vad.frameProcessor!;

// Process each frame
const out = { frameSamples, probs: "" };
const chars = " ▁▂▃▄▅▆▇█";
let lastTime = performance.now();
for (let i = 0; i < frameCount; i++) {
  const frame = f32Array.subarray(i * frameSamples, (i + 1) * frameSamples);
  const result = await frameProcessor.process(frame);
  if (!result.probs) break;
  const speechProbability = result.probs.isSpeech; // 0-1
  const index = Math.min(
    Math.floor(speechProbability * chars.length),
    chars.length - 1
  );
  out.probs += chars[index];
  if (performance.now() - lastTime > 1000) {
    console.log(
      "Processed",
      `${((i / frameCount) * 100).toFixed(1)}%`,
      `(${i}/${frameCount})`
    );
    lastTime = performance.now();
  }
}
console.log("Processing done.");

// Write the VAD result to a file
writeFileSync(vadResultPath, JSON.stringify(out));

// Initializing VAD prevents the process from exiting automatically, so force exit
process.exit(0);
