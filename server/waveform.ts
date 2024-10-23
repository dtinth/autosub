import { $ } from "bun";
import { decode } from "wav-decoder";

export async function createWaveform(mp3Path: string): Promise<number[]> {
  async function loadAudio(audioPath: string): Promise<[Float32Array, number]> {
    const ab =
      await $`ffmpeg -i ${audioPath} -f wav -ac 1 -ar 16000 -`.arrayBuffer();
    const buffer = Buffer.from(ab);
    let result = decode.sync(buffer);
    let audioData = new Float32Array(result.channelData[0].length);
    for (let i = 0; i < audioData.length; i++) {
      for (let j = 0; j < result.channelData.length; j++) {
        audioData[i] += result.channelData[j][i];
      }
    }
    return [audioData, result.sampleRate];
  }

  const [audioData, sampleRate] = await loadAudio(mp3Path);
  const buckets = Math.floor((audioData.length / sampleRate) * 10);

  const waveform = Array.from({ length: buckets }, (_, i) => {
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
    return +rms.toFixed(3);
  });

  return waveform;
}
