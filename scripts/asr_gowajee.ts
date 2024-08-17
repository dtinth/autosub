import fs from "fs";
import { setTimeout } from "timers/promises";

const API_KEY = process.env.GOWAJEE_API_KEY!;
const WEBHOOK_ID = process.env.GOWAJEE_WEBHOOK_ID!;
const BASE_URL = "https://api.gowajee.ai/v1/speech-to-text";

// Read the audio file
const audioBuffer = fs.readFileSync("audio.mp3");
const audioBase64 = audioBuffer.toString("base64");

// Send transcription request
console.log("Transcribing audio...");
const response = await fetch(
  `${BASE_URL}/pulse/transcribe/async?webhookId=${WEBHOOK_ID}`,
  {
    method: "POST",
    headers: {
      "x-api-key": API_KEY,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      audioData: audioBase64,
      getWordTimestamps: true,
    }),
  }
);

if (!response.ok) {
  console.error(await response.text());
  throw new Error(`HTTP error! status: ${response.status}`);
}

const data = await response.json();
console.log("Job ID:", data.jobId);

// Poll for job status
let jobStatus;
do {
  await setTimeout(5000); // Wait for 5 seconds before polling again

  const statusResponse = await fetch(
    `${BASE_URL}/pulse/job/status?id=${data.jobId}`,
    {
      headers: {
        "x-api-key": API_KEY,
      },
    }
  );

  if (!statusResponse.ok) {
    console.error(await response.text());
    throw new Error(`HTTP error! status: ${statusResponse.status}`);
  }

  jobStatus = await statusResponse.json();
  console.log("Job status:", jobStatus.status);
} while (jobStatus.status === "IN_QUEUE" || jobStatus.status === "IN_PROGRESS");

if (jobStatus.status === "COMPLETED") {
  console.log("Transcription result:", jobStatus.output);
} else {
  console.log("Transcription failed:", jobStatus);
}

fs.mkdirSync("artifacts", { recursive: true });
fs.writeFileSync(
  "artifacts/asr_gowajee.json",
  JSON.stringify(jobStatus, null, 2)
);
