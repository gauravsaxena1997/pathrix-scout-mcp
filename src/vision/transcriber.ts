import { spawnSync } from "child_process";
import path from "path";
import fs from "fs";

export interface TranscriptResult {
  language: string;
  text: string;
  segments: Array<{ start: number; end: number; text: string }>;
}

function getVenvPython(): string {
  if (process.env.SCOUT_VENV_PYTHON) return process.env.SCOUT_VENV_PYTHON;

  const candidates = [
    path.join(process.cwd(), "src", "lib", "scout", ".venv", "bin", "python3"),
    path.join(process.cwd(), "src", "lib", "scout", ".venv", "bin", "python"),
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  return "python3";
}

export function transcribeVideo(videoPath: string): TranscriptResult {
  const python = getVenvPython();
  const scriptPath = path.join(
    process.cwd(),
    "src", "lib", "scout", "python", "transcribe.py"
  );

  const modelSize = process.env.SCOUT_WHISPER_MODEL ?? "tiny";

  const result = spawnSync(python, [scriptPath, videoPath, modelSize], {
    encoding: "utf8",
    timeout: 600_000, // 10 min max for long videos
    maxBuffer: 10 * 1024 * 1024,
  });

  if (result.status !== 0 || result.error) {
    const errMsg = result.stderr?.trim() || result.error?.message || "transcription failed";
    throw new Error(`Transcription error: ${errMsg}`);
  }

  try {
    return JSON.parse(result.stdout);
  } catch {
    throw new Error(`Failed to parse transcription output: ${result.stdout?.slice(0, 200)}`);
  }
}
