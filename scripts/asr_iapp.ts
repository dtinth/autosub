import fs from "fs";

const API_KEY = process.env.IAPP_API_KEY!;
const BASE_URL = "https://api.iapp.co.th/asr/v3";

// Read the audio file
const audioFilePath = "audio.mp3"; // Make sure this file exists in your project directory
const audioBuffer = fs.readFileSync(audioFilePath);

// Create form data
const formData = new FormData();
formData.append("file", new Blob([audioBuffer]), "audio.mp3");

console.log("Transcribing audio...");

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

  // Save the result to a file
  fs.mkdirSync("artifacts", { recursive: true });
  fs.writeFileSync("artifacts/asr_iapp.json", JSON.stringify(data, null, 2));

  console.log("Transcription saved to artifacts/asr_iapp.json");
} catch (error) {
  console.error("Error:", error);
}
