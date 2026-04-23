import { SCOUT_UA, FETCH_TIMEOUT_MS, RSS_FEEDS } from "../config";
import { urlToId } from "../store/db";
import type { RawItem } from "../schema";
import { scoreItem } from "../intelligence/score";

// Re-export for convenience
export type { RssFeed } from "../config";

// ─── Minimal RSS/Atom parser ──────────────────────────────────────────────────

function extractTag(xml: string, tag: string): string {
  const match =
    xml.match(new RegExp(`<${tag}[^>]*><!\\[CDATA\\[([\\s\\S]*?)\\]\\]></${tag}>`, "i")) ??
    xml.match(new RegExp(`<${tag}[^>]*>([^<]*)</${tag}>`, "i"));
  return (match?.[1] ?? "").trim();
}

function extractAttr(xml: string, tag: string, attr: string): string {
  const match = xml.match(new RegExp(`<${tag}[^>]*\\s${attr}="([^"]*)"`, "i"));
  return (match?.[1] ?? "").trim();
}

function splitItems(xml: string): string[] {
  // Handle both RSS <item> and Atom <entry>
  const itemTag = xml.includes("<entry") ? "entry" : "item";
  const parts: string[] = [];
  const re = new RegExp(`<${itemTag}[\\s>]([\\s\\S]*?)</${itemTag}>`, "gi");
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml)) !== null) {
    parts.push(m[0]);
  }
  return parts;
}

function parseItem(chunk: string, sourceName: string): RawItem | null {
  // Try <link> as tag first, then as href attribute (Atom)
  let url =
    extractTag(chunk, "link") ||
    extractAttr(chunk, "link", "href") ||
    extractTag(chunk, "id");

  if (!url || !url.startsWith("http")) return null;

  const title =
    extractTag(chunk, "title") ||
    extractTag(chunk, "dc:title") ||
    "(no title)";

  const body =
    extractTag(chunk, "description") ||
    extractTag(chunk, "summary") ||
    extractTag(chunk, "content:encoded") ||
    extractTag(chunk, "content") ||
    "";

  const published =
    extractTag(chunk, "pubDate") ||
    extractTag(chunk, "published") ||
    extractTag(chunk, "updated") ||
    extractTag(chunk, "dc:date") ||
    "";

  const author =
    extractTag(chunk, "dc:creator") ||
    extractTag(chunk, "author") ||
    sourceName;

  let publishedAt = "";
  if (published) {
    try {
      publishedAt = new Date(published).toISOString();
    } catch {
      publishedAt = "";
    }
  }

  const id = urlToId(url);
  const raw: RawItem = {
    id,
    source: "rss",
    title: title.slice(0, 200),
    body: body.replace(/<[^>]+>/g, "").slice(0, 500),
    url,
    author,
    engagement: { score: 0, comments: 0 },
    publishedAt,
    scoutScore: 0,
  };
  raw.scoutScore = scoreItem(raw);
  return raw;
}

async function fetchFeed(feed: { name: string; url: string }): Promise<RawItem[]> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(feed.url, {
      headers: {
        "User-Agent": SCOUT_UA,
        Accept: "application/rss+xml, application/atom+xml, application/xml, text/xml, */*",
      },
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`http_${res.status}`);
    const xml = await res.text();
    const chunks = splitItems(xml);
    return chunks.map((c) => parseItem(c, feed.name)).filter(Boolean) as RawItem[];
  } finally {
    clearTimeout(timeout);
  }
}

export async function fetchAllFeeds(
  categories?: Array<"tech_news" | "ai_blog" | "arxiv" | "developer" | "freelance">
): Promise<RawItem[]> {
  const feeds = categories
    ? RSS_FEEDS.filter((f) => categories.includes(f.category))
    : RSS_FEEDS;

  const results = await Promise.allSettled(feeds.map(fetchFeed));
  const items: RawItem[] = [];

  results.forEach((r, i) => {
    if (r.status === "fulfilled") {
      items.push(...r.value);
    } else {
      console.warn(`[scout/rss] ${feeds[i].name}: failed -`, (r.reason as Error)?.message);
    }
  });

  return items;
}

export async function fetchSingleFeed(url: string, name = "feed"): Promise<RawItem[]> {
  return fetchFeed({ name, url });
}

export async function fetchYouTubeChannelFeed(channelId: string, channelName: string): Promise<RawItem[]> {
  const url = `https://www.youtube.com/feeds/videos.xml?channel_id=${channelId}`;
  const items = await fetchFeed({ name: channelName, url });
  // Override source to youtube for better scoring
  return items.map((i) => ({ ...i, source: "youtube" as const }));
}
