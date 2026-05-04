export { registerScoutTools, runGetTrending } from "./tools";
export { configureHandles, ScoutConfigSchema } from "./config";
export type { ScoutConfig } from "./config";
export { scrapeOwnProfile, getComments } from "./scrapers/reddit";
export { scrapeYoutubeProfile, getYoutubeChannelVideos } from "./scrapers/youtube";
export { analyzeVideo, analyzeVideos } from "./vision/pipeline";
export type { VideoAnalysis, VideoAnalysisError, AnalyzeVideosResult } from "./vision/pipeline";
export { getInstagramChannelPosts } from "./scrapers/apify";
export type { InstagramPost } from "./scrapers/apify";
export { saveProfileSnapshot, resolveThread, isThreadResolved } from "./store/db";
// Unified media store: canonical paths + cleanup for the lossless-sweep contract.
export { cleanupOldMedia, getMediaRoot, transcriptPath, videoPath, imageDir, rawScrapePath, visionDir, saveTranscript, readTranscript, saveRawScrape, saveVisionText, downloadImageSlides, downloadVideoFile } from "./store/media-store";
export type { RawItem, SourceItem, Platform, Engagement, ProfileSnapshot, ProfilePost, OpenThread, CommentSample } from "./schema";

// ─── Scraper primitives (used by Pathrix orchestrator for server-side collection) ─
export { fetchAllFeeds, fetchSingleFeed, fetchYouTubeChannelFeed } from "./scrapers/rss";
export { getHnByDate } from "./scrapers/hn";
export { getTrendingRepos } from "./scrapers/github";
export { getTrendingPolymarket } from "./scrapers/polymarket";

// ─── Open event hook (implement to receive lifecycle events from Scout) ───────

export type PackageEvent = {
  type: string;
  payload: Record<string, unknown>;
  timestamp: string;
};

export type OnEventHook = (e: PackageEvent) => void | Promise<void>;
