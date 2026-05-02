import { spawnSync } from "child_process";
import { urlToId } from "../store/db";
import type { RawItem, ProfileSnapshot } from "../schema";

function ytdlp(args: string[]): string {
  const result = spawnSync("yt-dlp", args, {
    encoding: "utf8",
    timeout: 60_000,
    maxBuffer: 10 * 1024 * 1024,
  });
  if (result.error) throw new Error(`yt-dlp not found: ${result.error.message}`);
  if (result.status !== 0) throw new Error(`yt-dlp failed: ${result.stderr?.slice(0, 300)}`);
  return result.stdout;
}

function parseUploadDate(d: string | undefined): string {
  if (!d || d.length !== 8) return new Date().toISOString();
  return `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}T00:00:00Z`;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- yt-dlp JSON response shape is undocumented; fields accessed defensively
function mapVideo(v: any): RawItem | null {
  if (!v?.webpage_url && !v?.url) return null;
  const url = v.webpage_url || `https://youtube.com/watch?v=${v.id}`;
  return {
    id: urlToId(url),
    source: "youtube",
    title: v.title ?? "",
    body: v.description?.slice(0, 500) ?? v.uploader ?? "",
    url,
    author: v.uploader ?? v.channel ?? "",
    publishedAt: parseUploadDate(v.upload_date),
    scoutScore: 0,
    engagement: {
      score: v.view_count ?? 0,
      comments: v.comment_count ?? 0,
      ratio: v.like_count ?? 0,
      topComment: undefined,
      probability: undefined,
    },
  };
}

export async function searchYoutube(query: string, limit = 20): Promise<RawItem[]> {
  const count = Math.min(limit, 50);
  let raw: string;
  try {
    raw = ytdlp([`ytsearch${count}:${query}`, "--flat-playlist", "--dump-single-json", "--no-warnings", "--quiet"]);
  } catch {
    return [];
  }
  try {
    const playlist = JSON.parse(raw);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- yt-dlp playlist entries have undocumented shape; mapped via mapVideo
    return (playlist?.entries ?? []).flatMap((v: any) => mapVideo(v) ?? []).slice(0, limit);
  } catch {
    return [];
  }
}

// dateAfter: yt-dlp --dateafter format YYYYMMDD. Filters to videos uploaded on or after that date.
export async function getYoutubeChannelVideos(channelUrl: string, limit = 10, dateAfter?: string): Promise<RawItem[]> {
  let raw: string;
  try {
    const args = [channelUrl, "--flat-playlist", "--dump-single-json", "--playlist-end", String(limit), "--no-warnings", "--quiet"];
    if (dateAfter) args.push("--dateafter", dateAfter);
    raw = ytdlp(args);
  } catch {
    return [];
  }
  try {
    const playlist = JSON.parse(raw);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- yt-dlp playlist entries have undocumented shape; mapped via mapVideo
    return (playlist?.entries ?? []).flatMap((v: any) => mapVideo(v) ?? []).slice(0, limit);
  } catch {
    return [];
  }
}

export async function scrapeYoutubeProfile(handle: string): Promise<ProfileSnapshot> {
  const channelUrl = handle.startsWith("@") ? `https://youtube.com/${handle}` : `https://youtube.com/c/${handle}`;
  let raw: string;
  try {
    raw = ytdlp([channelUrl, "--flat-playlist", "--dump-single-json", "--playlist-end", "10", "--no-warnings", "--quiet"]);
  } catch {
    return { platform: "youtube", handle, fetchedAt: new Date().toISOString(), followers: 0, posts: [], stats: {} };
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- yt-dlp channel JSON has undocumented shape; fields accessed defensively
  let channel: any;
  try {
    channel = JSON.parse(raw);
  } catch {
    return { platform: "youtube", handle, fetchedAt: new Date().toISOString(), followers: 0, posts: [], stats: {} };
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- yt-dlp entry objects have undocumented shape; fields accessed defensively
  const posts = (channel?.entries ?? []).slice(0, 10).map((v: any) => {
    const videoId = v.id ?? "";
    const thumbnailUrl = videoId
      ? `https://img.youtube.com/vi/${videoId}/hqdefault.jpg`
      : undefined;
    return {
      id: videoId || urlToId(v.url ?? ""),
      url: v.url ?? `https://youtube.com/watch?v=${videoId}`,
      content: v.title ?? "",
      publishedAt: parseUploadDate(v.upload_date),
      likes: v.like_count ?? 0,
      comments: v.comment_count ?? 0,
      shares: 0,
      views: v.view_count ?? 0,
      isViral: (v.view_count ?? 0) > 100_000,
      imageUrl: thumbnailUrl,
      duration: v.duration as number | undefined,
    };
  });

  // Separate avatar (square) from banner (wide) using yt-dlp thumbnail ids
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- yt-dlp thumbnail objects have undocumented shape; url/width/height accessed defensively
  const channelThumbs: any[] = channel?.thumbnails ?? [];
  const httpThumbs = channelThumbs.filter((t) => t?.url?.startsWith("http"));

  // Prefer explicitly-sized thumbnails (avoid =s0 "uncropped" variants which are blocked)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- yt-dlp thumbnail object shape unknown at compile time
  const sizeDefined = (t: any) => (t.width ?? 0) > 0 && (t.height ?? 0) > 0;
  const squareThumbs = httpThumbs.filter(sizeDefined).filter((t) => Math.abs((t.width ?? 0) - (t.height ?? 0)) < 100);
  const wideThumbs = httpThumbs.filter(sizeDefined).filter((t) => (t.width ?? 0) > (t.height ?? 0) * 1.5);

  const avatarThumb =
    squareThumbs.sort((a, b) => (b.width ?? 0) - (a.width ?? 0))[0] ??
    httpThumbs.find((t) => t?.id?.includes("avatar"));

  const bannerThumb =
    wideThumbs.sort((a, b) => (b.width ?? 0) - (a.width ?? 0))[0] ??
    httpThumbs.find((t) => t?.id?.includes("banner"));

  return {
    platform: "youtube",
    handle,
    fetchedAt: new Date().toISOString(),
    followers: channel?.channel_follower_count ?? 0,
    avatarUrl: avatarThumb?.url,
    bannerUrl: bannerThumb?.url,
    displayName: channel?.channel ?? channel?.uploader ?? handle,
    posts,
    stats: {
      subscriberCount: channel?.channel_follower_count ?? 0,
      videoCount: channel?.playlist_count ?? 0,
    },
  };
}
