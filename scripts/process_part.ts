import cp from "child_process";
import fs from "fs";

async function processPart(partName: string) {
  const env = { ...process.env, PART_NAME: partName };
  const run = (cmd: string) => {
    console.log("=> Running", cmd);
    cp.execSync(cmd, { stdio: "inherit", env });
  };
  if (fs.existsSync(`artifacts/${partName}.mp4`)) {
    run(`tsx ../../scripts/video_transcribe.ts`);
  } else if (fs.existsSync(`artifacts/${partName}.mp3`)) {
    run(`tsx ../../scripts/audio_transcribe.ts`);
  } else {
    throw new Error(`No video/audio artifacts found for part ${partName}`);
  }
  run(`tsx ../../scripts/transcript_improve.ts`);
  run(`tsx ../../scripts/align.ts`);
}

await processPart(process.argv[2]);
