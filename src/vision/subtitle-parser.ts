import fs from "fs";

export interface SubtitleParseResult {
  language: string;
  text: string;
  segments: Array<{ start: number; end: number; text: string }>;
}

function parseTimestamp(ts: string): number {
  const match = ts.match(/(\d+):(\d+):(\d+)\.(\d+)/);
  if (!match) return 0;
  return (
    parseInt(match[1]) * 3600 +
    parseInt(match[2]) * 60 +
    parseInt(match[3]) +
    parseInt(match[4]) / 1000
  );
}

function stripTags(s: string): string {
  return s
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ")
    .trim();
}

// YouTube VTT has word-timing cues (with <c> tags) interleaved with
// 0.01s "display checkpoint" cues (clean text). We parse all cues,
// strip tags, take the last non-empty line per cue, then deduplicate
// consecutive identical lines. This yields a clean ordered transcript.
export function parseVtt(vttPath: string): SubtitleParseResult {
  const raw = fs.readFileSync(vttPath, "utf8");

  // Detect language from the Kind/Language header
  const langMatch = raw.match(/^Language:\s*(\S+)/m);
  const language = langMatch?.[1] ?? "en";

  const blocks = raw.split(/\n\n+/);

  const lines: Array<{ start: number; end: number; text: string }> = [];

  for (const block of blocks) {
    const parts = block.trim().split("\n");
    const tsIdx = parts.findIndex((l) => l.includes(" --> "));
    if (tsIdx === -1) continue;

    const [startStr, endStr] = parts[tsIdx].split(" --> ");
    const start = parseTimestamp(startStr);
    const end = parseTimestamp(endStr);

    // Take all text lines after the timestamp, strip tags, drop empty lines
    const textLines = parts
      .slice(tsIdx + 1)
      .map(stripTags)
      .filter(Boolean);

    // Use the last non-empty line (the "current full line" for this cue)
    const text = textLines[textLines.length - 1];
    if (!text) continue;

    lines.push({ start, end, text });
  }

  // Deduplicate consecutive identical lines
  const deduped: typeof lines = [];
  for (const line of lines) {
    if (deduped.length === 0 || deduped[deduped.length - 1].text !== line.text) {
      deduped.push(line);
    }
  }

  // Build coarser segments (~sentence level) for readability
  // Group consecutive lines that differ (each is already a subtitle line boundary)
  const segments = deduped.map((l, i) => ({
    start: l.start,
    end: deduped[i + 1]?.start ?? l.end,
    text: l.text,
  }));

  const text = deduped.map((l) => l.text).join(" ");

  return { language, text, segments };
}
