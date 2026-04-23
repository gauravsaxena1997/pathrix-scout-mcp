import { spawnSync } from "child_process";
import path from "path";
import fs from "fs";
import crypto from "crypto";
import os from "os";

export const TEMP_DIR =
  process.env.SCOUT_TEMP_DIR ??
  path.join(os.homedir(), ".local", "share", "pathrix-scout", "tmp");

export interface DownloadResult {
  videoPath: string;
  title: string;
  duration: number;
  cleanup: () => void;
}

export async function downloadVideo(url: string): Promise<DownloadResult> {
  const runId = crypto.randomUUID().slice(0, 8);
  const outDir = path.join(TEMP_DIR, runId);
  fs.mkdirSync(outDir, { recursive: true });

  // Fetch metadata first (fast, no download)
  const meta = spawnSync(
    "yt-dlp",
    ["--dump-json", "--no-playlist", "--no-download", url],
    { encoding: "utf8" }
  );

  if (meta.status !== 0) {
    fs.rmSync(outDir, { recursive: true, force: true });
    throw new Error(`yt-dlp metadata error: ${meta.stderr?.trim() ?? "unknown"}`);
  }

  let title = "Unknown";
  let duration = 0;
  try {
    const parsed = JSON.parse(meta.stdout);
    title = parsed.title ?? "Unknown";
    duration = parsed.duration ?? 0;
  } catch {
    // non-fatal
  }

  // Download: best quality up to 720p to keep file size reasonable
  const dl = spawnSync(
    "yt-dlp",
    [
      "-f", "bestvideo[height<=720]+bestaudio/best[height<=720]/best",
      "-o", path.join(outDir, "%(id)s.%(ext)s"),
      "--no-playlist",
      "--no-progress",
      url,
    ],
    { encoding: "utf8", maxBuffer: 10 * 1024 * 1024 }
  );

  if (dl.status !== 0) {
    fs.rmSync(outDir, { recursive: true, force: true });
    throw new Error(`yt-dlp download error: ${dl.stderr?.trim() ?? "unknown"}`);
  }

  const files = fs.readdirSync(outDir);
  if (files.length === 0) {
    fs.rmSync(outDir, { recursive: true, force: true });
    throw new Error("yt-dlp produced no output file");
  }

  return {
    videoPath: path.join(outDir, files[0]),
    title,
    duration,
    cleanup: () => fs.rmSync(outDir, { recursive: true, force: true }),
  };
}
