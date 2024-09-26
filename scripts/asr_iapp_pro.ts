import fs from "fs";
import { getPartName } from "../src/getPartName";

const partName = getPartName();
const API_KEY = process.env.IAPP_API_KEY!;
const BASE_URL = "https://api.iapp.co.th/asr/v3";

// Read the audio file
const audioFilePath = `artifacts/${partName}.mp3`;
const audioBuffer = fs.readFileSync(audioFilePath);

// Create form data
const formData = new FormData();
formData.append("file", new Blob([audioBuffer]), "audio.mp3");
formData.append("use_asr_pro", "1");

console.log("Transcribing audio with iApp ASR PRO...");

try {
  const response = await fetch(BASE_URL, {
    method: "POST",
    headers: {
      apikey: API_KEY,
    },
    body: formData,
  });

  if (!response.ok) {
    throw new Error(
      `HTTP error! status: ${response.status} ${await response.text()}`
    );
  }

  const data = await response.json();
  console.log("Transcription result:", JSON.stringify(data, null, 2));

  fs.writeFileSync(
    `artifacts/${partName}.iapp_asr.json`,
    JSON.stringify(data, null, 2)
  );

  console.log("Transcription saved to", `artifacts/${partName}.iapp_asr.json`);
} catch (error) {
  console.error("Error:", error);
}
