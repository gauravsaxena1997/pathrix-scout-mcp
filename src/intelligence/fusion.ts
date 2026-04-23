import type { RawItem, SourceItem } from "../schema";
import { tokenJaccard } from "./score";

const RRF_K = 60;
const MAX_PER_AUTHOR = 3;
const MIN_PER_SOURCE = 2;

interface Stream {
  items: RawItem[];
  weight: number;
}

/**
 * Reciprocal Rank Fusion (Cormack 2009)
 * Fuses multiple ranked lists into one. Items appearing consistently
 * across multiple sources beat items dominant in only one.
 */
export function rrfFuse(streams: Stream[], limit = 30): SourceItem[] {
  const scores = new Map<string, number>();
  const itemMap = new Map<string, RawItem>();

  for (const stream of streams) {
    // Sort by scoutScore descending within each stream
    const sorted = [...stream.items].sort((a, b) => b.scoutScore - a.scoutScore);

    sorted.forEach((item, rank) => {
      const prev = scores.get(item.id) ?? 0;
      scores.set(item.id, prev + stream.weight / (RRF_K + rank));
      if (!itemMap.has(item.id)) itemMap.set(item.id, item);
    });
  }

  // Sort by RRF score descending
  const ranked = [...scores.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([id, rrfScore]) => ({
      ...(itemMap.get(id) as RawItem),
      rrfScore,
    })) as SourceItem[];

  return applyDiversity(ranked, limit);
}

/** Enforce max-per-author and ensure min source diversity */
function applyDiversity(items: SourceItem[], limit: number): SourceItem[] {
  const authorCounts = new Map<string, number>();
  const sourceCounts = new Map<string, number>();
  const result: SourceItem[] = [];

  for (const item of items) {
    if (result.length >= limit) break;

    const authorKey = `${item.source}:${item.author}`;
    const authorCount = authorCounts.get(authorKey) ?? 0;
    if (authorCount >= MAX_PER_AUTHOR) continue;

    authorCounts.set(authorKey, authorCount + 1);
    sourceCounts.set(item.source, (sourceCounts.get(item.source) ?? 0) + 1);
    result.push(item);
  }

  // Backfill minimum per source if any source has 0 items
  const sources = new Set(items.map((i) => i.source));
  for (const src of sources) {
    if ((sourceCounts.get(src) ?? 0) < MIN_PER_SOURCE) {
      const candidates = items
        .filter((i) => i.source === src && !result.find((r) => r.id === i.id))
        .slice(0, MIN_PER_SOURCE - (sourceCounts.get(src) ?? 0));
      result.push(...candidates);
    }
  }

  return result.slice(0, limit);
}

/** Build streams from grouped items. Applies SOURCE_QUALITY weights by default. */
export function buildStreams(
  grouped: Map<string, RawItem[]>,
  weights?: Partial<Record<string, number>>
): Stream[] {
  return [...grouped.entries()].map(([source, items]) => ({
    items,
    weight: weights?.[source] ?? 1.0,
  }));
}

/**
 * Near-deduplication by title similarity across all items.
 * If two items have token Jaccard >= 0.70 on their titles, keep the higher-scored one.
 * Catches same story at different URLs from different sources.
 */
export function nearDedup(items: RawItem[]): RawItem[] {
  const kept: RawItem[] = [];
  for (const item of items) {
    const dupIdx = kept.findIndex(
      (k) => k.id !== item.id && tokenJaccard(k.title ?? "", item.title ?? "") >= 0.70
    );
    if (dupIdx >= 0) {
      if (item.scoutScore > kept[dupIdx].scoutScore) {
        kept[dupIdx] = item;
      }
    } else {
      kept.push(item);
    }
  }
  return kept;
}
