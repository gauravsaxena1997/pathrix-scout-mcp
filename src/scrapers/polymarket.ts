import { FETCH_TIMEOUT_MS } from "../config";
import { urlToId } from "../store/db";
import type { RawItem } from "../schema";

const GAMMA_API = "https://gamma-api.polymarket.com";

async function polyFetch(url: string) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      headers: { Accept: "application/json" },
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`http_${res.status}`);
    return res.json();
  } finally {
    clearTimeout(timeout);
  }
}

function mapMarket(m: any): RawItem | null {
  if (!m?.question) return null;
  const url = m.url || `https://polymarket.com/event/${m.slug || m.id}`;
  const probability = typeof m.outcomePrices === "string"
    ? parseFloat(JSON.parse(m.outcomePrices)?.[0] ?? "0.5")
    : typeof m.bestBid === "number"
    ? m.bestBid
    : 0.5;
  return {
    id: urlToId(url),
    source: "polymarket",
    title: m.question,
    body: m.description ?? "",
    url,
    author: "",
    publishedAt: m.startDate ?? new Date().toISOString(),
    scoutScore: 0,
    engagement: {
      score: Math.round(probability * 100),
      comments: m.commentCount ?? 0,
      ratio: probability,
      topComment: m.topComment ?? null,
      probability,
    },
  };
}

export async function searchPolymarket(query: string, limit = 20): Promise<RawItem[]> {
  const params = new URLSearchParams({ q: query, limit: String(Math.min(limit, 50)) });
  const data = await polyFetch(`${GAMMA_API}/markets?${params}`);
  const markets: any[] = Array.isArray(data) ? data : data?.markets ?? [];
  return markets.flatMap((m) => mapMarket(m) ?? []).slice(0, limit);
}

export async function getTrendingPolymarket(limit = 20): Promise<RawItem[]> {
  const params = new URLSearchParams({
    active: "true",
    order: "volume",
    ascending: "false",
    limit: String(Math.min(limit, 50)),
  });
  const data = await polyFetch(`${GAMMA_API}/markets?${params}`);
  const markets: any[] = Array.isArray(data) ? data : data?.markets ?? [];
  return markets.flatMap((m) => mapMarket(m) ?? []).slice(0, limit);
}
