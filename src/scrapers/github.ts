import { execSync } from "child_process";
import { urlToId } from "../store/db";
import type { RawItem } from "../schema";
import { scoreItem } from "../intelligence/score";

function runGh(args: string): any {
  try {
    const out = execSync(`gh ${args}`, {
      encoding: "utf8",
      timeout: 15_000,
      stdio: ["pipe", "pipe", "pipe"],
    });
    return JSON.parse(out);
  } catch (err: any) {
    const msg: string = err?.stderr ?? err?.message ?? String(err);
    if (msg.includes("not logged") || msg.includes("auth")) {
      throw new Error("github_not_authenticated");
    }
    throw new Error(`gh_error: ${msg.slice(0, 200)}`);
  }
}

function mapRepo(repo: any): RawItem | null {
  const url = repo.url ?? repo.htmlUrl ?? repo.html_url;
  if (!url) return null;
  const id = urlToId(url);
  const raw: RawItem = {
    id,
    source: "github",
    title: `${repo.nameWithOwner ?? repo.name}: ${repo.description ?? ""}`,
    body: repo.description ?? "",
    url,
    author: repo.owner?.login ?? repo.nameWithOwner?.split("/")?.[0] ?? "",
    engagement: {
      score: repo.stargazerCount ?? repo.stargazers_count ?? 0,
      comments: repo.forkCount ?? repo.forks_count ?? 0,
    },
    publishedAt: repo.pushedAt ?? repo.pushed_at ?? "",
    scoutScore: 0,
  };
  raw.scoutScore = scoreItem(raw);
  return raw;
}

export async function searchGithub(query: string, limit = 15): Promise<RawItem[]> {
  const json = runGh(
    `search repos ${JSON.stringify(query)} --json nameWithOwner,description,stargazerCount,forkCount,url,pushedAt,owner --limit ${limit}`
  );
  return (Array.isArray(json) ? json : json?.items ?? [])
    .map(mapRepo)
    .filter(Boolean) as RawItem[];
}

export async function getTrendingRepos(language?: string, limit = 10): Promise<RawItem[]> {
  const langFilter = language ? `language:${language}` : "";
  const dateFilter = `pushed:>${new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10)}`;
  const q = `stars:>100 ${dateFilter} ${langFilter}`.trim();
  return searchGithub(q, limit);
}
