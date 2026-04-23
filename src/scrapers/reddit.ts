import { SCOUT_UA, FETCH_TIMEOUT_MS, DEFAULT_SUBREDDITS } from "../config";
import { urlToId } from "../store/db";
import type { RawItem, ProfileSnapshot } from "../schema";
import { scoreItem } from "../intelligence/score";

const BASE = "https://old.reddit.com";

async function redditFetch(url: string) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": SCOUT_UA, Accept: "application/json" },
      signal: controller.signal,
    });
    if (res.status === 429) throw new Error("rate_limited");
    if (res.status === 404) throw new Error("not_found");
    if (!res.ok) throw new Error(`http_${res.status}`);
    return res.json();
  } finally {
    clearTimeout(timeout);
  }
}

function mapPost(child: any): RawItem | null {
  const d = child?.data;
  if (!d || !d.url) return null;
  const url = d.url.startsWith("http") ? d.url : `https://reddit.com${d.url}`;
  const id = urlToId(url);
  const raw: RawItem = {
    id,
    source: "reddit",
    title: d.title ?? "(no title)",
    body: (d.selftext ?? "").slice(0, 500),
    url,
    author: d.author ?? "",
    engagement: {
      score: d.score ?? 0,
      comments: d.num_comments ?? 0,
      ratio: d.upvote_ratio ?? 0.5,
    },
    publishedAt: d.created_utc ? new Date(d.created_utc * 1000).toISOString() : "",
    scoutScore: 0,
  };
  raw.scoutScore = scoreItem(raw);
  return raw;
}

export async function searchReddit(query: string, limit = 25): Promise<RawItem[]> {
  const subreddits = DEFAULT_SUBREDDITS.slice(0, 5).join("+");
  const url = `${BASE}/r/${subreddits}/search.json?q=${encodeURIComponent(query)}&sort=relevance&t=week&limit=${limit}`;
  const json = await redditFetch(url);
  const children = json?.data?.children ?? [];
  return children.map(mapPost).filter(Boolean) as RawItem[];
}

export async function searchSubreddit(
  subreddit: string,
  query: string,
  limit = 20
): Promise<RawItem[]> {
  const url = `${BASE}/r/${subreddit}/search.json?q=${encodeURIComponent(query)}&restrict_sr=1&sort=top&t=week&limit=${limit}`;
  const json = await redditFetch(url);
  const children = json?.data?.children ?? [];
  return children.map(mapPost).filter(Boolean) as RawItem[];
}

export async function getHotPosts(subreddit: string, limit = 10): Promise<RawItem[]> {
  const url = `${BASE}/r/${subreddit}/hot.json?limit=${limit}`;
  const json = await redditFetch(url);
  const children = json?.data?.children ?? [];
  return children.map(mapPost).filter(Boolean) as RawItem[];
}

export async function scrapeOwnProfile(handle: string): Promise<ProfileSnapshot> {
  const [about, submitted] = await Promise.all([
    redditFetch(`${BASE}/user/${encodeURIComponent(handle)}/about.json`),
    redditFetch(`${BASE}/user/${encodeURIComponent(handle)}/submitted.json?limit=25&sort=new`),
  ]);

  const d = about?.data ?? {};
  const posts = (submitted?.data?.children ?? [])
    .map((c: any) => {
      const p = c?.data;
      if (!p) return null;
      const url = p.url?.startsWith("http") ? p.url : `https://reddit.com${p.url ?? ""}`;
      return {
        id: p.id ?? urlToId(url),
        url,
        content: p.title ?? "",
        publishedAt: p.created_utc ? new Date(p.created_utc * 1000).toISOString() : "",
        likes: p.score ?? 0,
        comments: p.num_comments ?? 0,
        isViral: (p.score ?? 0) > 1000,
      };
    })
    .filter(Boolean);

  return {
    platform: "reddit",
    handle,
    fetchedAt: new Date().toISOString(),
    followers: typeof d.num_followers === "number" ? d.num_followers : 0,
    posts,
    stats: {
      post_karma: d.link_karma ?? 0,
      comment_karma: d.comment_karma ?? 0,
      total_karma: (d.link_karma ?? 0) + (d.comment_karma ?? 0),
      account_age_days: d.created_utc
        ? Math.floor((Date.now() - d.created_utc * 1000) / 86400000)
        : 0,
    },
  };
}
