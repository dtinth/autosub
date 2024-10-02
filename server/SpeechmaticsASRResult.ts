export interface SpeechmaticsASRResult {
  results: {
    alternatives: {
      confidence: number;
      content: string;
    }[];
    start_time: number;
    end_time: number;
  }[];
}
