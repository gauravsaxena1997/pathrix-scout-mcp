import { FETCH_TIMEOUT_MS } from "../config";
import { urlToId } from "../store/db";
import type { RawItem } from "../schema";
import { scoreItem } from "../intelligence/score";

const ALGOLIA = "https://hn.algolia.com/api/v1";

async function hnFetch(url: string) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) throw new Error(`http_${res.status}`);
    return res.json();
  } finally {
    clearTimeout(timeout);
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- HN Algolia API hit object shape is external; no published TypeScript types
function mapHit(hit: any): RawItem | null {
  const url = hit.url ?? `https://news.ycombinator.com/item?id=${hit.objectID}`;
  if (!url) return null;
  const id = urlToId(url);
  const raw: RawItem = {
    id,
    source: "hn",
    title: hit.title ?? "(no title)",
    body: hit.story_text?.slice(0, 500) ?? "",
    url,
    author: hit.author ?? "",
    engagement: {
      score: hit.points ?? 0,
      comments: hit.num_comments ?? 0,
    },
    publishedAt: hit.created_at ?? "",
    scoutScore: 0,
  };
  raw.scoutScore = scoreItem(raw);
  return raw;
}

export async function searchHn(query: string, limit = 20): Promise<RawItem[]> {
  const url = `${ALGOLIA}/search?query=${encodeURIComponent(query)}&tags=story&hitsPerPage=${limit}`;
  const json = await hnFetch(url);
  return (json?.hits ?? []).map(mapHit).filter(Boolean) as RawItem[];
}

export async function getHnFrontPage(limit = 20): Promise<RawItem[]> {
  const url = `${ALGOLIA}/search?tags=front_page&hitsPerPage=${limit}`;
  const json = await hnFetch(url);
  return (json?.hits ?? []).map(mapHit).filter(Boolean) as RawItem[];
}

export async function getHnByDate(query: string, daysBack = 7, limit = 20): Promise<RawItem[]> {
  const since = Math.floor((Date.now() - daysBack * 86400000) / 1000);
  const url = `${ALGOLIA}/search_by_date?query=${encodeURIComponent(query)}&tags=story&numericFilters=created_at_i>${since}&hitsPerPage=${limit}`;
  const json = await hnFetch(url);
  return (json?.hits ?? []).map(mapHit).filter(Boolean) as RawItem[];
}
