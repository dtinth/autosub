import { createVtt } from "./createVtt";
import { IAppResult } from "./iApp";
import { Partitions } from "./Partitions";

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

  return createVtt(segments);
}
