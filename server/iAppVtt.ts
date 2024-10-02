import { IAppResult } from "./iApp";
import { Partitions } from "./Partitions";

function formatTime(time: number) {
  const hours = Math.floor(time / 3600);
  const minutes = Math.floor((time % 3600) / 60);
  const seconds = time % 60;
  return `${hours.toString().padStart(2, "0")}:${minutes
    .toString()
    .padStart(2, "0")}:${seconds.toFixed(3).padStart(6, "0")}`;
}

export async function createVttFromIApp(options: {
  partitions: Partitions;
  getResult: (partName: string) => Promise<IAppResult>;
}) {
  const segments: { text: string; start: number; end: number }[] = [];

  for (const { name: partName, start } of options.partitions.partitions) {
    const data = await options.getResult(partName);
    for (const segment of data.output) {
      segments.push({
        text: segment.text,
        start: segment.start + start,
        end: segment.end + start,
      });
    }
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

  return webvtt.join("\n");
}
