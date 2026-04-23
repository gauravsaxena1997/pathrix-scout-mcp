import { MAX_CONCURRENT } from "../config";

/** Simple concurrency limiter - avoids p-limit dependency */
export async function pLimit<T>(
  tasks: (() => Promise<T>)[],
  concurrency = MAX_CONCURRENT
): Promise<PromiseSettledResult<T>[]> {
  const results: PromiseSettledResult<T>[] = new Array(tasks.length);
  let index = 0;

  async function worker() {
    while (index < tasks.length) {
      const i = index++;
      try {
        results[i] = { status: "fulfilled", value: await tasks[i]() };
      } catch (err) {
        results[i] = { status: "rejected", reason: err };
      }
    }
  }

  const workers = Array.from({ length: Math.min(concurrency, tasks.length) }, worker);
  await Promise.all(workers);
  return results;
}

/** Run scrapers in parallel, skip failures, collect successes */
export async function runScrapers<T>(
  scrapers: Array<{ name: string; fn: () => Promise<T[]> }>
): Promise<{ name: string; items: T[] }[]> {
  const tasks = scrapers.map((s) => () => s.fn());
  const results = await pLimit(tasks);

  return results.map((result, i) => {
    if (result.status === "fulfilled") {
      return { name: scrapers[i].name, items: result.value };
    }
    const err = result.reason as Error;
    const msg = err?.message ?? String(result.reason);
    // 429 = rate limited, log and skip
    if (msg.includes("rate_limited") || msg.includes("429")) {
      console.warn(`[scout] ${scrapers[i].name}: rate limited, skipping`);
    } else {
      console.error(`[scout] ${scrapers[i].name}: failed -`, msg);
    }
    return { name: scrapers[i].name, items: [] };
  });
}
