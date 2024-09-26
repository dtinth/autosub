import { execFileSync } from "child_process";
import { existsSync, readFileSync, writeFileSync } from "fs";
import { decode } from "wav-decoder";

const audioSamplePath = process.argv[2] || `audio.mp3`;

console.log(`Processing ${audioSamplePath}`);

function loadAudio(audioPath: string) {
  const buffer = execFileSync(
    "ffmpeg",
    ["-i", audioPath, "-f", "wav", "-ac", "1", "-ar", "16000", "-"],
    { stdio: ["pipe", "pipe", "inherit"], maxBuffer: 1024 * 1024 * 1024 }
  );
  let result = decode.sync(buffer);
  let audioData = new Float32Array(result.channelData[0].length);
  for (let i = 0; i < audioData.length; i++) {
    for (let j = 0; j < result.channelData.length; j++) {
      audioData[i] += result.channelData[j][i];
    }
  }
  return [audioData, result.sampleRate];
}

const main = async () => {
  const [audioData, sampleRate] = loadAudio(audioSamplePath);
  const buckets = (audioData.length / sampleRate) * 10;
  const result = Array.from({ length: buckets }, (_, i) => {
    const start = i * 0.1;
    const end = start + 0.1;
    const startIndex = Math.floor(start * sampleRate);
    const endIndex = Math.floor(end * sampleRate);
    let sum = 0;
    let samples = 0;
    for (let j = startIndex; j < endIndex && j < audioData.length; j++) {
      sum += audioData[j] ** 2;
      samples++;
    }
    const rms = Math.sqrt(sum / samples);
    if (i > 0 && i % 80 === 0) {
      process.stdout.write("\n");
    }
    if (rms < 0.1) {
      process.stdout.write(`.`);
    } else if (rms < 0.25) {
      process.stdout.write(`:`);
    } else {
      process.stdout.write(`|`);
    }
    return +rms.toFixed(3);
  });
  const words: [number, string][] = [];
  if (existsSync(`artifacts/speechmatics_asr.json`)) {
    const asr = JSON.parse(
      readFileSync(`artifacts/speechmatics_asr.json`, "utf8")
    );
    interface Result {
      start_time: number;
      end_time: number;
      alternatives: { content: string }[];
    }
    for (const result of asr.results as Result[]) {
      words.push([result.start_time, result.alternatives[0].content]);
    }
  }
  writeFileSync(
    process.argv[3] || "artifacts/waveform.json",
    JSON.stringify({ waveform: result, words })
  );
};

await main();
