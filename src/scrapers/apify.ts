import { ApifyClient } from "apify-client";
import type { RawItem, Platform } from "../schema";
import { urlToId } from "../store/db";
import { scoreItem } from "../intelligence/score";

// ─── Token Pool ───────────────────────────────────────────────────────────────

class ApifyTokenPool {
  private readonly tokens: string[];
  private index = 0;

  constructor(tokensEnv: string) {
    this.tokens = tokensEnv
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean);
  }

  get configured(): boolean {
    return this.tokens.length > 0;
  }

  get count(): number {
    return this.tokens.length;
  }

  next(): string {
    if (!this.configured) throw new Error("APIFY_TOKENS not set");
    const token = this.tokens[this.index];
    this.index = (this.index + 1) % this.tokens.length;
    return token;
  }
}

export const apifyPool = new ApifyTokenPool(process.env.APIFY_TOKENS ?? "");

// ─── Actor Registry ───────────────────────────────────────────────────────────

export const APIFY_ACTOR_REGISTRY = {
  // Upwork
  "upwork-jobs":            "neatrat/upwork-job-scraper",
  // LinkedIn
  "linkedin-jobs":          "curious_coder/linkedin-jobs-scraper",
  "linkedin-profiles":      "harvestapi/linkedin-profile-scraper",
  "linkedin-posts":         "harvestapi/linkedin-profile-posts",
  "linkedin-enrichment":    "anchor/linkedin-profile-enrichment",
  "linkedin-full-profiles": "dev_fusion/Linkedin-Profile-Scraper",
  // PeoplePerHour
  "peopleperhour-jobs":     "getdataforme/PeoplePerHour-Job-Scraper",
  // Instagram
  "instagram-posts":        "apify/instagram-post-scraper",
  "instagram-profiles":     "coderx/instagram-profile-scraper-bio-posts",
  // Fiverr
  "fiverr-listings":        "sovereigntaylor/fiverr-scraper",
  // X / Twitter
  "x-posts":                "parseforge/x-com-scraper",
} as const;

export type ApifyActorKey = keyof typeof APIFY_ACTOR_REGISTRY;

// Maps each actor key to the Platform it produces results for
const ACTOR_PLATFORM: Record<ApifyActorKey, Platform> = {
  "upwork-jobs":            "upwork",
  "linkedin-jobs":          "linkedin",
  "linkedin-profiles":      "linkedin",
  "linkedin-posts":         "linkedin",
  "linkedin-enrichment":    "linkedin",
  "linkedin-full-profiles": "linkedin",
  "peopleperhour-jobs":     "web",
  "instagram-posts":        "instagram",
  "instagram-profiles":     "instagram",
  "fiverr-listings":        "fiverr",
  "x-posts":                "x",
};

// ─── Input Builders ───────────────────────────────────────────────────────────
// query = keyword for job/content searches, or handle/URL for profile scrapers
// extra = caller-supplied overrides merged on top

type InputBuilder = (query: string, limit: number, extra: Record<string, unknown>) => Record<string, unknown>;

const INPUT_BUILDERS: Record<ApifyActorKey, InputBuilder> = {
  "upwork-jobs": (query, limit, extra) => ({
    query,
    maxResults: limit,
    ...extra,
  }),
  "linkedin-jobs": (query, limit, extra) => ({
    keyword: query,
    location: "",
    limit,
    ...extra,
  }),
  "linkedin-profiles": (query, limit, extra) => ({
    // query is a LinkedIn profile URL or comma-separated list of URLs
    profileUrls: query.includes(",") ? query.split(",").map((u) => u.trim()) : [query],
    maxResults: limit,
    ...extra,
  }),
  "linkedin-posts": (query, limit, extra) => ({
    // query is a LinkedIn profile URL
    profileUrls: [query],
    maxResults: limit,
    ...extra,
  }),
  "linkedin-enrichment": (query, _limit, extra) => ({
    profileUrls: query.includes(",") ? query.split(",").map((u) => u.trim()) : [query],
    ...extra,
  }),
  "linkedin-full-profiles": (query, _limit, extra) => ({
    // query is a LinkedIn profile URL
    url: query,
    ...extra,
  }),
  "peopleperhour-jobs": (query, limit, extra) => ({
    queries: [query],
    maxResults: limit,
    ...extra,
  }),
  "instagram-posts": (query, limit, extra) => ({
    // query is a comma-separated list of usernames or a single username
    usernames: query.includes(",") ? query.split(",").map((u) => u.trim().replace(/^@/, "")) : [query.trim().replace(/^@/, "")],
    resultsLimit: limit,
    ...extra,
  }),
  "instagram-profiles": (query, limit, extra) => ({
    usernames: query.includes(",") ? query.split(",").map((u) => u.trim().replace(/^@/, "")) : [query.trim().replace(/^@/, "")],
    maxResults: limit,
    ...extra,
  }),
  "fiverr-listings": (query, limit, extra) => ({
    searchQuery: query,
    maxResults: limit,
    ...extra,
  }),
  "x-posts": (query, limit, extra) => ({
    // query is a Twitter/X username (without @)
    handles: [query.trim().replace(/^@/, "")],
    tweetsDesired: limit,
    ...extra,
  }),
};

// ─── Output Mappers ───────────────────────────────────────────────────────────
// Normalize actor-specific output to RawItem

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- Apify actor outputs are untyped external data
type OutputMapper = (raw: any, platform: Platform) => RawItem | null;

function safeUrl(url: unknown): string {
  if (typeof url === "string" && url.startsWith("http")) return url;
  return "";
}

function safeStr(val: unknown, fallback = ""): string {
  return typeof val === "string" ? val : fallback;
}

function safeNum(val: unknown, fallback = 0): number {
  return typeof val === "number" ? val : fallback;
}

function safeDate(val: unknown): string {
  if (!val) return new Date().toISOString();
  if (typeof val === "string") return val;
  if (typeof val === "number") return new Date(val * 1000).toISOString();
  return new Date().toISOString();
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- each mapper receives untyped external actor output
const OUTPUT_MAPPERS: Record<ApifyActorKey, OutputMapper> = {
  "upwork-jobs": (raw, platform) => {
    const url = safeUrl(raw?.url ?? raw?.jobUrl ?? raw?.link);
    if (!url) return null;
    const title = safeStr(raw?.title ?? raw?.jobTitle, "(no title)");
    const body = safeStr(raw?.description ?? raw?.snippet, "").slice(0, 500);
    const item: RawItem = {
      id: urlToId(url),
      source: platform,
      title,
      body,
      url,
      author: safeStr(raw?.clientName ?? raw?.company ?? raw?.client),
      engagement: {
        score: safeNum(raw?.budget ?? raw?.hourlyRate ?? 0),
        comments: safeNum(raw?.proposals ?? raw?.applicants ?? 0),
      },
      publishedAt: safeDate(raw?.createdAt ?? raw?.postedAt ?? raw?.date),
      scoutScore: 0,
    };
    item.scoutScore = scoreItem(item);
    return item;
  },

  "linkedin-jobs": (raw, platform) => {
    const url = safeUrl(raw?.jobUrl ?? raw?.url ?? raw?.link);
    if (!url) return null;
    const title = safeStr(raw?.title ?? raw?.jobTitle, "(no title)");
    const body = [safeStr(raw?.description), safeStr(raw?.companyName), safeStr(raw?.location)].filter(Boolean).join(" - ").slice(0, 500);
    const item: RawItem = {
      id: urlToId(url),
      source: platform,
      title,
      body,
      url,
      author: safeStr(raw?.companyName ?? raw?.company),
      engagement: {
        score: 0,
        comments: safeNum(raw?.applicants ?? raw?.applicantCount ?? 0),
      },
      publishedAt: safeDate(raw?.postedAt ?? raw?.postedDate ?? raw?.date),
      scoutScore: 0,
    };
    item.scoutScore = scoreItem(item);
    return item;
  },

  "linkedin-profiles": (raw, platform) => {
    const url = safeUrl(raw?.profileUrl ?? raw?.url ?? raw?.linkedinUrl);
    const name = safeStr(raw?.fullName ?? `${safeStr(raw?.firstName)} ${safeStr(raw?.lastName)}`.trim(), "(no name)");
    const fallbackUrl = url || `https://linkedin.com/in/${safeStr(raw?.username ?? raw?.publicIdentifier ?? "unknown")}`;
    const item: RawItem = {
      id: urlToId(fallbackUrl),
      source: platform,
      title: name,
      body: safeStr(raw?.headline ?? raw?.summary ?? raw?.about, "").slice(0, 500),
      url: fallbackUrl,
      author: name,
      engagement: {
        score: safeNum(raw?.followersCount ?? raw?.followers ?? 0),
        comments: 0,
      },
      publishedAt: new Date().toISOString(),
      scoutScore: 0,
    };
    item.scoutScore = scoreItem(item);
    return item;
  },

  "linkedin-posts": (raw, platform) => {
    const url = safeUrl(raw?.postUrl ?? raw?.url);
    if (!url) return null;
    const item: RawItem = {
      id: urlToId(url),
      source: platform,
      title: safeStr(raw?.text ?? raw?.content, "").slice(0, 100),
      body: safeStr(raw?.text ?? raw?.content, "").slice(0, 500),
      url,
      author: safeStr(raw?.authorName ?? raw?.author?.name ?? raw?.author),
      engagement: {
        score: safeNum(raw?.likesCount ?? raw?.likes ?? 0),
        comments: safeNum(raw?.commentsCount ?? raw?.comments ?? 0),
      },
      publishedAt: safeDate(raw?.postedAt ?? raw?.date ?? raw?.publishedAt),
      scoutScore: 0,
    };
    item.scoutScore = scoreItem(item);
    return item;
  },

  "linkedin-enrichment": (raw, platform) => {
    const url = safeUrl(raw?.profileUrl ?? raw?.url ?? raw?.linkedinUrl);
    const name = safeStr(raw?.fullName ?? raw?.name, "(no name)");
    const fallbackUrl = url || `https://linkedin.com/in/${safeStr(raw?.publicIdentifier ?? "unknown")}`;
    const item: RawItem = {
      id: urlToId(fallbackUrl),
      source: platform,
      title: name,
      body: safeStr(raw?.headline ?? raw?.title, "").slice(0, 500),
      url: fallbackUrl,
      author: name,
      engagement: {
        score: safeNum(raw?.followersCount ?? raw?.followers ?? 0),
        comments: 0,
      },
      publishedAt: new Date().toISOString(),
      scoutScore: 0,
    };
    item.scoutScore = scoreItem(item);
    return item;
  },

  "linkedin-full-profiles": (raw, platform) => {
    const url = safeUrl(raw?.profileUrl ?? raw?.url ?? raw?.linkedinUrl);
    const name = safeStr(raw?.fullName ?? raw?.name, "(no name)");
    const fallbackUrl = url || `https://linkedin.com/in/${safeStr(raw?.username ?? "unknown")}`;
    const item: RawItem = {
      id: urlToId(fallbackUrl),
      source: platform,
      title: name,
      body: [safeStr(raw?.headline), safeStr(raw?.email), safeStr(raw?.phone)].filter(Boolean).join(" | ").slice(0, 500),
      url: fallbackUrl,
      author: name,
      engagement: {
        score: safeNum(raw?.followersCount ?? raw?.followers ?? 0),
        comments: 0,
      },
      publishedAt: new Date().toISOString(),
      scoutScore: 0,
    };
    item.scoutScore = scoreItem(item);
    return item;
  },

  "peopleperhour-jobs": (raw, platform) => {
    const url = safeUrl(raw?.url ?? raw?.jobUrl ?? raw?.link);
    if (!url) return null;
    const item: RawItem = {
      id: urlToId(url),
      source: platform,
      title: safeStr(raw?.title ?? raw?.jobTitle, "(no title)"),
      body: safeStr(raw?.description ?? raw?.snippet, "").slice(0, 500),
      url,
      author: safeStr(raw?.clientName ?? raw?.buyerName ?? raw?.username),
      engagement: {
        score: safeNum(raw?.budget ?? raw?.budgetMax ?? 0),
        comments: safeNum(raw?.bids ?? raw?.proposals ?? 0),
      },
      publishedAt: safeDate(raw?.postedAt ?? raw?.createdAt ?? raw?.date),
      scoutScore: 0,
    };
    item.scoutScore = scoreItem(item);
    return item;
  },

  "instagram-posts": (raw, platform) => {
    const url = safeUrl(raw?.url ?? (raw?.shortCode && `https://www.instagram.com/p/${raw.shortCode}/`));
    if (!url) return null;
    const item: RawItem = {
      id: urlToId(url),
      source: platform,
      title: safeStr(raw?.caption ?? raw?.text, "").slice(0, 100),
      body: safeStr(raw?.caption ?? raw?.text, "").slice(0, 500),
      url,
      author: safeStr(raw?.ownerUsername ?? raw?.username ?? raw?.author),
      engagement: {
        score: safeNum(raw?.likesCount ?? raw?.likes ?? 0),
        comments: safeNum(raw?.commentsCount ?? raw?.comments ?? 0),
      },
      publishedAt: safeDate(raw?.timestamp ?? raw?.takenAt ?? raw?.publishedAt),
      scoutScore: 0,
    };
    item.scoutScore = scoreItem(item);
    return item;
  },

  "instagram-profiles": (raw, platform) => {
    const username = safeStr(raw?.username ?? raw?.handle);
    const url = safeUrl(raw?.url) || `https://www.instagram.com/${username}/`;
    const item: RawItem = {
      id: urlToId(url),
      source: platform,
      title: safeStr(raw?.fullName ?? raw?.name ?? username, username),
      body: safeStr(raw?.biography ?? raw?.bio, "").slice(0, 500),
      url,
      author: username,
      engagement: {
        score: safeNum(raw?.followersCount ?? raw?.followers ?? 0),
        comments: safeNum(raw?.followsCount ?? raw?.following ?? 0),
      },
      publishedAt: new Date().toISOString(),
      scoutScore: 0,
    };
    item.scoutScore = scoreItem(item);
    return item;
  },

  "fiverr-listings": (raw, platform) => {
    const url = safeUrl(raw?.url ?? raw?.gigUrl);
    if (!url) return null;
    const item: RawItem = {
      id: urlToId(url),
      source: platform,
      title: safeStr(raw?.title ?? raw?.gigTitle, "(no title)"),
      body: [safeStr(raw?.description), `$${safeNum(raw?.price ?? raw?.startingPrice)}`].filter(Boolean).join(" - ").slice(0, 500),
      url,
      author: safeStr(raw?.sellerName ?? raw?.seller ?? raw?.username),
      engagement: {
        score: safeNum(raw?.rating ?? raw?.avgRating ?? 0),
        comments: safeNum(raw?.reviewCount ?? raw?.reviews ?? 0),
      },
      publishedAt: new Date().toISOString(),
      scoutScore: 0,
    };
    item.scoutScore = scoreItem(item);
    return item;
  },

  "x-posts": (raw, platform) => {
    const url = safeUrl(raw?.url ?? raw?.tweetUrl ?? (raw?.id && `https://x.com/i/web/status/${raw.id}`));
    if (!url) return null;
    const item: RawItem = {
      id: urlToId(url),
      source: platform,
      title: safeStr(raw?.text ?? raw?.fullText ?? raw?.content, "").slice(0, 100),
      body: safeStr(raw?.text ?? raw?.fullText ?? raw?.content, "").slice(0, 500),
      url,
      author: safeStr(raw?.author?.userName ?? raw?.username ?? raw?.authorUsername),
      engagement: {
        score: safeNum(raw?.likeCount ?? raw?.favoriteCount ?? raw?.likes ?? 0),
        comments: safeNum(raw?.replyCount ?? raw?.replies ?? 0),
        ratio: safeNum(raw?.retweetCount ?? raw?.retweets ?? 0),
      },
      publishedAt: safeDate(raw?.createdAt ?? raw?.date),
      scoutScore: 0,
    };
    item.scoutScore = scoreItem(item);
    return item;
  },
};

// ─── Main Scraper Function ────────────────────────────────────────────────────

export async function scrapeApify(
  actor: ApifyActorKey,
  query: string,
  limit = 20,
  extraInput: Record<string, unknown> = {}
): Promise<RawItem[]> {
  if (!apifyPool.configured) {
    throw new Error("APIFY_TOKENS not set - add comma-separated Apify API tokens to .env");
  }

  const token = apifyPool.next();
  const client = new ApifyClient({ token });
  const actorId = APIFY_ACTOR_REGISTRY[actor];
  const platform = ACTOR_PLATFORM[actor];
  const input = INPUT_BUILDERS[actor](query, limit, extraInput);
  const mapper = OUTPUT_MAPPERS[actor];

  const run = await client.actor(actorId).call(input, { timeout: 120 });
  const { items } = await client.dataset(run.defaultDatasetId).listItems({ limit });

  return items
    .map((item) => mapper(item, platform))
    .filter((item): item is RawItem => item !== null);
}

// ─── Status ───────────────────────────────────────────────────────────────────

export function getApifyStatus() {
  return {
    configured: apifyPool.configured,
    tokenCount: apifyPool.count,
    actors: Object.keys(APIFY_ACTOR_REGISTRY) as ApifyActorKey[],
  };
}
