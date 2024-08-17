import fs, { writeFileSync } from "fs";
import { basename } from "path";
import speechmatics from "speechmatics";

const sm = new speechmatics.Speechmatics({
  apiKey: process.env.SPEECHMATICS_API_KEY!,
});
const input = new Blob([fs.readFileSync("audio.mp3")]);

console.log("Performing ASR on audio file...");
fs.mkdirSync("artifacts", { recursive: true });
sm.batch
  .transcribe(
    { data: input, fileName: basename(process.cwd()) + "_audio.mp3" },
    {
      transcription_config: {
        language: "th",
        operating_point: "standard", // enhanced
      },
    },
    "json-v2"
  )
  .then((transcript) => {
    writeFileSync(
      "artifacts/speechmatics_asr.json",
      JSON.stringify(transcript)
    );
    console.log("ASR completed.");
  })
  .catch((error) => {
    console.log(error);
    process.exit(1);
  });
