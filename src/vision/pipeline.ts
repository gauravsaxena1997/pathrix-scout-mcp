import { downloadVideo } from "./downloader";
import { transcribeVideo } from "./transcriber";

export interface VideoAnalysis {
  url: string;
  title: string;
  duration: number;
  language: string;
  transcript: string;
  segments: Array<{ start: number; end: number; text: string }>;
  analyzedAt: string;
}

export async function analyzeVideo(url: string): Promise<VideoAnalysis> {
  const download = await downloadVideo(url);
  try {
    const transcript = transcribeVideo(download.videoPath);
    return {
      url,
      title: download.title,
      duration: download.duration,
      language: transcript.language,
      transcript: transcript.text,
      segments: transcript.segments,
      analyzedAt: new Date().toISOString(),
    };
  } finally {
    download.cleanup();
  }
}

export async function analyzeVideos(urls: string[]): Promise<VideoAnalysis[]> {
  const results: VideoAnalysis[] = [];
  for (const url of urls) {
    try {
      results.push(await analyzeVideo(url));
    } catch (err) {
      console.error(`[scout/vision] Failed: ${url} -`, (err as Error).message);
    }
  }
  return results;
}
