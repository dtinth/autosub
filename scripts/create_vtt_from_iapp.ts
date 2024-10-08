import fs from "fs";
import { parseArgs } from "util";

const args = parseArgs({
  options: {
    partial: { type: "boolean" },
    skip: { type: "string" },
  },
});

const parts = JSON.parse(fs.readFileSync("artifacts/parts.json", "utf8"));
const segments: { text: string; start: number; end: number }[] = [];
for (const { name: partName, start } of parts.slice(+args.values.skip! || 0)) {
  const data = JSON.parse(
    fs.readFileSync(`artifacts/${partName}.iapp_asr.json`, "utf8")
  );
  for (const segment of data.output) {
    segments.push({
      text: segment.text,
      start: segment.start + start,
      end: segment.end + start,
    });
  }
}

/**
 * Parse a time string in the format "HH:MM:SS.mmm".
 */
function parseTime(text: string) {
  const parts = text.split(":");
  let sum = 0;
  parts.reverse().forEach((part, i) => {
    sum += parseFloat(part) * Math.pow(60, i);
  });
  return sum;
}

/**
 * Formats time in seconds to "HH:MM:SS.mmm".
 */
function formatTime(time: number) {
  const hours = Math.floor(time / 3600);
  const minutes = Math.floor((time % 3600) / 60);
  const seconds = time % 60;
  return `${hours.toString().padStart(2, "0")}:${minutes
    .toString()
    .padStart(2, "0")}:${seconds.toFixed(3).padStart(6, "0")}`;
}

const webvtt: string[] = [
  "WEBVTT - Auto-generated by https://github.com/dtinth/autosub (with iApp ASR PRO)",
];
for (const segment of segments) {
  webvtt.push("");
  webvtt.push(`${formatTime(segment.start)} --> ${formatTime(segment.end)}`);
  webvtt.push(segment.text);
}
webvtt.push("");

fs.writeFileSync("artifacts/subtitles.vtt", webvtt.join("\n"));

console.log('Written to "artifacts/subtitles.vtt"');
