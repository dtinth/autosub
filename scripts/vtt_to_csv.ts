import fs from "fs";
import * as subtitle from "subtitle";

const vtt = fs.existsSync("fixed.vtt")
  ? fs.readFileSync("fixed.vtt", "utf8")
  : fs.readFileSync("artifacts/subtitles.vtt", "utf8");

const parsed = subtitle.parseSync(vtt);
const cues = parsed.filter((x) => x.type === "cue").map((x) => x.data);
const pad = (x: number) => x.toString().padStart(2, "0");

for (const cue of cues) {
  const seconds = cue.start / 1000;
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  console.log(`${m}:${pad(s)}, ` + cue.text.replace(/\s+/g, " "));
}
