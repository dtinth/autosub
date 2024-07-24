import cp from "child_process";
import fs from "fs";

const parts = JSON.parse(fs.readFileSync("artifacts/parts.json", "utf8"));

for (const part of parts) {
  const start = part.start;
  const end = part.end;
  const audio = `artifacts/${part.name}.mp4`;
  console.log(`Cutting from ${start} to ${end} to ${audio}`);
  cp.execSync(
    `ffmpeg -i video.mp4 -ss ${start} -to ${end} -c:a copy -c:v libx264 -crf 23 -preset veryfast ${audio} -y`,
    {
      stdio: "inherit",
    }
  );
}
