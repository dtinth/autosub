import fs from "fs";

export interface IAppResult {
  output: {
    text: string;
    speaker: string;
    start: number;
    end: number;
    segment: number;
  }[];
}

export async function transcribeWithIApp(
  inPath: string,
  options: {
    pro: boolean;
    log: (message: string) => void;
  }
) {
  const { log, pro } = options;
  const API_KEY = process.env.IAPP_API_KEY!;
  const BASE_URL = "https://api.iapp.co.th/asr/v3";
  const audioBuffer = fs.readFileSync(inPath);

  // Create form data
  const formData = new FormData();
  formData.append("file", new Blob([audioBuffer]), "audio.mp3");
  formData.append("use_asr_pro", pro ? "1" : "0");
  log(`Transcribing audio with iApp ASR ${pro ? "PRO" : "Standard"}...`);

  const response = await fetch(BASE_URL, {
    method: "POST",
    headers: { apikey: API_KEY },
    body: formData,
  });

  if (!response.ok) {
    throw new Error(
      `HTTP error! status: ${response.status} ${await response.text()}`
    );
  }

  const data = await response.json();
  return data as IAppResult;
}
