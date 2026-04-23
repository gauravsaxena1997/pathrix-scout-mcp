import crypto from "crypto";
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Platform } from "./schema";
import type { RawItem } from "./schema";
import { applyScores } from "./intelligence/score";
import { rrfFuse, buildStreams, nearDedup } from "./intelligence/fusion";
import { runScrapers } from "./intelligence/parallel";
import { SOURCE_QUALITY } from "./config";
import { saveRun, saveItems, searchItems, saveProfileSnapshot, getLatestProfileSnapshot } from "./store/db";

// ─── Lazy imports for scrapers ────────────────────────────────────────────────

async function getReddit() {
  return import("./scrapers/reddit");
}
async function getHn() {
  return import("./scrapers/hn");
}
async function getGithub() {
  return import("./scrapers/github");
}
async function getRss() {
  return import("./scrapers/rss");
}

// ─── Tool: search_topic ───────────────────────────────────────────────────────

async function runSearchTopic(
  query: string,
  sources: Platform[],
  timeframeDays: number,
  limit: number
) {
  const runId = crypto.randomUUID();
  saveRun(runId, query);

  const activeReddit = sources.includes("reddit");
  const activeHn = sources.includes("hn");
  const activeGithub = sources.includes("github");
  const activeRss = sources.includes("rss");

  const scraperList: Array<{ name: string; fn: () => Promise<any[]> }> = [];

  if (activeReddit) {
    const reddit = await getReddit();
    scraperList.push({ name: "reddit", fn: () => reddit.searchReddit(query, 25) });
  }
  if (activeHn) {
    const hn = await getHn();
    scraperList.push({ name: "hn", fn: () => hn.getHnByDate(query, timeframeDays, 20) });
  }
  if (activeGithub) {
    const github = await getGithub();
    scraperList.push({ name: "github", fn: () => github.searchGithub(query, 15) });
  }
  if (activeRss) {
    const rss = await getRss();
    scraperList.push({ name: "rss", fn: () => rss.fetchAllFeeds(["ai_blog", "tech_news", "developer"]) });
  }

  const results = await runScrapers(scraperList);
  const grouped = new Map<string, any[]>();
  const allScored: any[] = [];
  for (const { name, items } of results) {
    const scored = applyScores(items, query);
    grouped.set(name, scored);
    allScored.push(...scored);
  }

  const dedupedIds = new Set(nearDedup(allScored).map((i: any) => i.id));
  for (const [src, items] of grouped) {
    grouped.set(src, items.filter((i: any) => dedupedIds.has(i.id)));
  }

  const streams = buildStreams(grouped, SOURCE_QUALITY);
  const fused = rrfFuse(streams, limit);
  saveItems(fused, runId);

  const sourceBreakdown: Partial<Record<Platform, number>> = {};
  for (const [src, items] of grouped) {
    sourceBreakdown[src as Platform] = items.length;
  }

  return {
    query,
    items: fused,
    clusters: [],
    runId,
    generatedAt: new Date().toISOString(),
    sourceBreakdown,
  };
}

// ─── Tool: get_trending ───────────────────────────────────────────────────────

export async function runGetTrending(niche: string, timeframeDays: number, limit: number) {
  return runSearchTopic(niche, ["reddit", "hn", "github", "rss"], timeframeDays, limit);
}

// ─── Tool: scrape_own_profiles ────────────────────────────────────────────────

async function runScrapeOwnProfiles(platforms: Platform[]) {
  const results: any[] = [];

  if (platforms.includes("reddit")) {
    const handle = process.env.SCOUT_REDDIT_HANDLE;
    if (handle) {
      try {
        const reddit = await getReddit();
        const snapshot = await reddit.scrapeOwnProfile(handle);
        saveProfileSnapshot(snapshot);
        results.push({ platform: "reddit", status: "ok", followers: snapshot.followers });
      } catch (err) {
        results.push({ platform: "reddit", status: "error", error: (err as Error).message });
      }
    } else {
      results.push({ platform: "reddit", status: "skipped", reason: "SCOUT_REDDIT_HANDLE not set" });
    }
  }

  return results;
}

// ─── Tool: scout_search_fts ───────────────────────────────────────────────────

async function runFtsSearch(q: string, limit: number) {
  return searchItems(q, limit);
}

// ─── Tool: raw_scrape ─────────────────────────────────────────────────────────

async function runRawScrape(
  query: string,
  sources: Platform[],
  timeframeDays: number,
  limit: number
) {
  const activeReddit = sources.includes("reddit");
  const activeHn = sources.includes("hn");
  const activeGithub = sources.includes("github");
  const activeRss = sources.includes("rss");

  const scraperList: Array<{ name: string; fn: () => Promise<any[]> }> = [];

  if (activeReddit) {
    const reddit = await getReddit();
    scraperList.push({ name: "reddit", fn: () => reddit.searchReddit(query, limit) });
  }
  if (activeHn) {
    const hn = await getHn();
    scraperList.push({ name: "hn", fn: () => hn.getHnByDate(query, timeframeDays, limit) });
  }
  if (activeGithub) {
    const github = await getGithub();
    scraperList.push({ name: "github", fn: () => github.searchGithub(query, limit) });
  }
  if (activeRss) {
    const rss = await getRss();
    scraperList.push({ name: "rss", fn: () => rss.fetchAllFeeds() });
  }

  const results = await runScrapers(scraperList);
  const perSource: Record<string, any[]> = {};
  let totalItems = 0;
  for (const { name, items } of results) {
    perSource[name] = items.slice(0, limit);
    totalItems += perSource[name].length;
  }

  return {
    query,
    sources: perSource,
    totalItems,
    fetchedAt: new Date().toISOString(),
  };
}

// ─── Tool: score_and_rank ─────────────────────────────────────────────────────

function runScoreAndRank(items: RawItem[], limit: number) {
  const scored = applyScores(items);
  const grouped = new Map<string, typeof scored>();
  for (const item of scored) {
    const bucket = grouped.get(item.source) ?? [];
    bucket.push(item);
    grouped.set(item.source, bucket);
  }
  const streams = buildStreams(grouped, SOURCE_QUALITY);
  return rrfFuse(streams, limit);
}

// ─── Tool: analyze_video ──────────────────────────────────────────────────────

async function runAnalyzeVideo(urls: string[]) {
  const { analyzeVideos } = await import("./vision/pipeline");
  return analyzeVideos(urls);
}

// ─── Register all Scout tools on the MCP server ───────────────────────────────

export function registerScoutTools(mcpServer: McpServer) {
  mcpServer.tool(
    "search_topic",
    "Scout: Search a topic across Reddit, HN, GitHub, and RSS feeds. Returns RRF-fused ranked results.",
    {
      query: z.string().describe("Topic or keyword to search"),
      sources: z
        .array(z.enum(["reddit", "hn", "github", "rss", "youtube"]))
        .optional()
        .default(["reddit", "hn", "github", "rss"])
        .describe("Sources to include"),
      timeframe_days: z
        .number()
        .optional()
        .default(7)
        .describe("Look-back window in days"),
      limit: z.number().optional().default(20).describe("Max results to return"),
    },
    async ({ query, sources, timeframe_days, limit }) => {
      const report = await runSearchTopic(
        query,
        sources as Platform[],
        timeframe_days,
        limit
      );
      return { content: [{ type: "text", text: JSON.stringify(report, null, 2) }] };
    }
  );

  mcpServer.tool(
    "get_trending",
    "Scout: Get trending content for a niche across all sources in the past N days.",
    {
      niche: z.string().describe("Niche or topic e.g. 'AI agents', 'SaaS', 'Next.js'"),
      timeframe_days: z.number().optional().default(7).describe("Days to look back"),
      limit: z.number().optional().default(15).describe("Max results"),
    },
    async ({ niche, timeframe_days, limit }) => {
      const report = await runGetTrending(niche, timeframe_days, limit);
      return { content: [{ type: "text", text: JSON.stringify(report, null, 2) }] };
    }
  );

  mcpServer.tool(
    "scrape_own_profiles",
    "Scout: Scrape own social profiles for follower count, recent posts, and performance stats.",
    {
      platforms: z
        .array(z.enum(["reddit", "youtube", "x", "instagram"]))
        .optional()
        .default(["reddit"])
        .describe("Which profiles to scrape"),
    },
    async ({ platforms }) => {
      const results = await runScrapeOwnProfiles(platforms as Platform[]);
      return { content: [{ type: "text", text: JSON.stringify(results, null, 2) }] };
    }
  );

  mcpServer.tool(
    "get_profile_snapshot",
    "Scout: Get the latest stored profile snapshot for a platform.",
    {
      platform: z
        .enum(["reddit", "youtube", "x", "instagram"])
        .describe("Platform to fetch snapshot for"),
    },
    async ({ platform }) => {
      const snapshot = getLatestProfileSnapshot(platform);
      return {
        content: [
          {
            type: "text",
            text: snapshot ? JSON.stringify(snapshot, null, 2) : `No snapshot found for ${platform}`,
          },
        ],
      };
    }
  );

  mcpServer.tool(
    "scout_search",
    "Scout: Full-text search over previously fetched Scout items stored in local SQLite.",
    {
      query: z.string().describe("Full-text search query"),
      limit: z.number().optional().default(20).describe("Max results"),
    },
    async ({ query, limit }) => {
      const items = await runFtsSearch(query, limit);
      return { content: [{ type: "text", text: JSON.stringify(items, null, 2) }] };
    }
  );

  mcpServer.tool(
    "raw_scrape",
    "Scout: Scrape sources without the intelligence layer. Returns raw per-source results with no scoring or RRF fusion.",
    {
      query: z.string().describe("Topic or keyword to search"),
      sources: z
        .array(z.enum(["reddit", "hn", "github", "rss"]))
        .optional()
        .default(["reddit", "hn", "github", "rss"])
        .describe("Sources to scrape"),
      timeframe_days: z.number().optional().default(7).describe("Look-back window in days"),
      limit: z.number().optional().default(10).describe("Max results per source"),
    },
    async ({ query, sources, timeframe_days, limit }) => {
      const result = await runRawScrape(query, sources as Platform[], timeframe_days, limit);
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    }
  );

  mcpServer.tool(
    "score_and_rank",
    "Scout: Run the intelligence layer (scoring + RRF fusion) on items you already have. Useful when you scraped raw data and want to rank it.",
    {
      items: z
        .array(
          z.object({
            id: z.string(),
            source: z.string(),
            title: z.string(),
            body: z.string().optional().default(""),
            url: z.string().optional().default(""),
            author: z.string().optional().default(""),
            engagement: z
              .object({ score: z.number().optional().default(0), comments: z.number().optional().default(0) })
              .optional()
              .default({ score: 0, comments: 0 }),
            publishedAt: z.string().optional().default(""),
            scoutScore: z.number().optional().default(0),
          })
        )
        .describe("Raw items to score and rank"),
      limit: z.number().optional().default(20).describe("Max results after fusion"),
    },
    async ({ items, limit }) => {
      const ranked = runScoreAndRank(items as RawItem[], limit);
      return { content: [{ type: "text", text: JSON.stringify(ranked, null, 2) }] };
    }
  );

  mcpServer.tool(
    "analyze_video",
    "Scout: Download and transcribe one or more public videos (YouTube, Instagram, any yt-dlp-supported URL). Returns transcript + metadata.",
    {
      urls: z
        .array(z.string().url())
        .describe("One or more video URLs to analyze"),
    },
    async ({ urls }) => {
      const results = await runAnalyzeVideo(urls);
      return { content: [{ type: "text", text: JSON.stringify(results, null, 2) }] };
    }
  );
}
