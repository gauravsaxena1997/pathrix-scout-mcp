export type Platform =
  | "reddit"
  | "hn"
  | "github"
  | "rss"
  | "x"
  | "youtube"
  | "instagram"
  | "upwork";

export type TargetType =
  | "SOCIAL_MEDIA"
  | "OWN_PROFILE"
  | "DEVELOPER"
  | "FREELANCE"
  | "PREDICTION"
  | "NEWS_RESEARCH";

export type AuthType =
  | "NO_AUTH"
  | "FREE_API_KEY"
  | "COOKIE_AUTH"
  | "ACCOUNT_AUTH";

export interface Engagement {
  score: number;
  comments: number;
  ratio?: number;
  topComment?: string;
  probability?: number;
}

export interface RawItem {
  /** SHA-256 of normalized URL - dedup key */
  id: string;
  source: Platform;
  title: string;
  body: string;
  url: string;
  author: string;
  engagement: Engagement;
  publishedAt: string;
  /** Per-source normalized score (0-1) */
  scoutScore: number;
}

export interface SourceItem extends RawItem {
  /** Reciprocal Rank Fusion score across all streams */
  rrfScore: number;
}

export interface ProfilePost {
  id: string;
  url: string;
  content: string;
  publishedAt: string;
  likes: number;
  comments: number;
  shares?: number;
  views?: number;
  isViral: boolean;
}

export interface ProfileSnapshot {
  platform: Platform;
  handle: string;
  fetchedAt: string;
  followers: number;
  posts: ProfilePost[];
  stats: Record<string, number>;
}

export interface Cluster {
  label: string;
  items: string[];
  representative: string;
}

export interface ScoutReport {
  query: string;
  items: SourceItem[];
  clusters: Cluster[];
  runId: string;
  generatedAt: string;
  sourceBreakdown: Partial<Record<Platform, number>>;
}

export interface SubQuery {
  label: string;
  searchQuery: string;
  sources: Platform[];
  weight: number;
}
