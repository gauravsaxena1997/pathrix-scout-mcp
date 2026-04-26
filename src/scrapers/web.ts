import { FETCH_TIMEOUT_MS, WEB_SEARCH } from "../config";
import { urlToId } from "../store/db";
import type { RawItem } from "../schema";

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- external web search API response shape varies by provider; parsed defensively
async function fetchJson(url: string, headers: Record<string, string> = {}): Promise<any> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, { headers, signal: controller.signal });
    if (!res.ok) throw new Error(`http_${res.status}`);
    return res.json();
  } finally {
    clearTimeout(timeout);
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- SearXNG result object shape is external API response; no published TypeScript types
function mapSearxResult(r: any, _index: number): RawItem | null {
  if (!r?.url || !r?.title) return null;
  return {
    id: urlToId(r.url),
    source: "web",
    title: r.title,
    body: r.content ?? "",
    url: r.url,
    author: r.engines?.[0] ?? "web",
    publishedAt: r.publishedDate ?? new Date().toISOString(),
    scoutScore: 0,
    engagement: { score: 0, comments: 0 },
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- Brave Search API result shape is external; no published TypeScript types
function mapBraveResult(r: any): RawItem | null {
  if (!r?.url || !r?.title) return null;
  return {
    id: urlToId(r.url),
    source: "web",
    title: r.title,
    body: r.description ?? "",
    url: r.url,
    author: "brave",
    publishedAt: r.page_age ?? new Date().toISOString(),
    scoutScore: 0,
    engagement: { score: 0, comments: 0 },
  };
}

async function searchSearXNG(query: string, limit: number): Promise<RawItem[]> {
  const params = new URLSearchParams({ q: query, format: "json" });
  const data = await fetchJson(`${WEB_SEARCH.searxngUrl}/search?${params}`);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- SearXNG results array element shape is external API response
  const results: any[] = Array.isArray(data?.results) ? data.results : [];
  return results
    .flatMap((r, i) => mapSearxResult(r, i) ?? [])
    .slice(0, limit);
}

async function searchBrave(query: string, limit: number): Promise<RawItem[]> {
  const params = new URLSearchParams({ q: query, count: String(Math.min(limit, 20)) });
  const data = await fetchJson(
    `https://api.search.brave.com/res/v1/web/search?${params}`,
    { "X-Subscription-Token": WEB_SEARCH.braveApiKey, Accept: "application/json" }
  );
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Brave Search API web results array element shape is external API response
  const results: any[] = data?.web?.results ?? [];
  return results
    .flatMap((r) => mapBraveResult(r) ?? [])
    .slice(0, limit);
}

export async function searchWeb(query: string, limit = 15): Promise<RawItem[]> {
  if (WEB_SEARCH.searxngUrl) return searchSearXNG(query, limit);
  if (WEB_SEARCH.braveApiKey) return searchBrave(query, limit);
  return [];
}
