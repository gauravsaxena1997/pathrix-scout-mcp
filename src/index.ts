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
export type { RawItem, SourceItem, Platform, Engagement, ProfileSnapshot, ProfilePost, OpenThread, CommentSample } from "./schema";

// ─── Open event hook (implement to receive lifecycle events from Scout) ───────

export type PackageEvent = {
  type: string;
  payload: Record<string, unknown>;
  timestamp: string;
};

export type OnEventHook = (e: PackageEvent) => void | Promise<void>;
