import type { RawItem, Engagement } from "../schema";

function log1p(x: number): number {
  return Math.log1p(Math.max(0, x));
}

function scoreReddit(e: Engagement): number {
  return (
    0.50 * log1p(e.score) +
    0.35 * log1p(e.comments) +
    0.05 * log1p((e.ratio ?? 0.5) * 10) +
    0.10 * log1p(e.topComment ? 1 : 0)
  );
}

function scoreHn(e: Engagement): number {
  return 0.60 * log1p(e.score) + 0.40 * log1p(e.comments);
}

function scoreGithub(e: Engagement): number {
  return 0.70 * log1p(e.score) + 0.30 * log1p(e.comments);
}

function scoreYoutube(e: Engagement): number {
  return (
    0.50 * log1p(e.score) +
    0.35 * log1p(e.comments) +
    0.15 * log1p(e.ratio ?? 0)
  );
}

function scoreX(e: Engagement): number {
  return (
    0.50 * log1p(e.score) +
    0.30 * log1p(e.comments) +
    0.20 * log1p(e.ratio ?? 0)
  );
}

function scoreInstagram(e: Engagement): number {
  return 0.60 * log1p(e.score) + 0.40 * log1p(e.comments);
}

function scoreRss(_e: Engagement): number {
  return 0.5;
}

const SCORERS: Record<string, (e: Engagement) => number> = {
  reddit: scoreReddit,
  hn: scoreHn,
  github: scoreGithub,
  youtube: scoreYoutube,
  x: scoreX,
  instagram: scoreInstagram,
  rss: scoreRss,
};

function sigmoid(x: number): number {
  return 1 / (1 + Math.exp(-x / 5));
}

function engagementScore(item: RawItem): number {
  const scorer = SCORERS[item.source] ?? scoreRss;
  return sigmoid(scorer(item.engagement));
}

// ─── Recency decay (0 at 30+ days old, 1.0 today) ────────────────────────────
function recencyScore(publishedAt: string): number {
  if (!publishedAt) return 0.5;
  const days = (Date.now() - new Date(publishedAt).getTime()) / 86_400_000;
  return Math.max(0, 1 - days / 30);
}

// ─── Token Jaccard relevance (query vs item text) ─────────────────────────────
const STOPWORDS = new Set(["the","a","an","is","to","of","and","in","for","on","at","with","by","from","this","that","are","was","be","as","it","its","or","but","not","we","you","they","he","she","have","has","had","do","does","did","will","would","can","could","should","may","might","been","than","then","so","if","when","how","what","which","who"]);

function toTokens(text: string): Set<string> {
  return new Set(
    text.toLowerCase().split(/\W+/).filter((t) => t.length > 2 && !STOPWORDS.has(t))
  );
}

export function tokenJaccard(query: string, text: string): number {
  const qTokens = toTokens(query);
  const tTokens = toTokens(text);
  if (qTokens.size === 0) return 0;
  const intersection = [...qTokens].filter((t) => tTokens.has(t)).length;
  return intersection / Math.max(qTokens.size + tTokens.size - intersection, 1);
}

// ─── Composite local rank score (used when query is known) ────────────────────
// Weights match last-30-days signals.py: 65% relevance, 25% freshness, 10% engagement.
export function localRankScore(item: RawItem, query: string): number {
  const text = `${item.title ?? ""} ${(item.body ?? "").slice(0, 300)}`;
  const relevance = tokenJaccard(query, text);
  const freshness = recencyScore(item.publishedAt);
  const engagement = engagementScore(item);
  return 0.65 * relevance + 0.25 * freshness + 0.10 * engagement;
}

export function scoreItem(item: RawItem): number {
  return engagementScore(item);
}

/** Apply scores. If query provided, uses composite local rank score (relevance + recency + engagement). */
export function applyScores(items: RawItem[], query?: string): RawItem[] {
  return items.map((item) => ({
    ...item,
    scoutScore: query ? localRankScore(item, query) : scoreItem(item),
  }));
}
