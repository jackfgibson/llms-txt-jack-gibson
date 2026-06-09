import { safeFetch, SsrfError } from "@/lib/url/ssrf";
import { normalizePath } from "./normalize";

// HOW_TO_CRAWL.md §5.1 Fetcher.
//
// We layer the spec's retry/backoff/redirect/body-cache behaviour on top of
// `safeFetch`, which provides the project's required SSRF protection
// (re-validates the resolved IP after every redirect). The Ferrum/Chrome
// headless refetch path is intentionally NOT implemented — JS pages are
// detected and flagged (isJavascriptRendered) but never rendered.

const DEFAULT_UA = "llms-txt-fetcher/0.1";
const TIMEOUT_MS = 10_000; // per-request timeout (was 30s — too slow for batched crawls)
const MAX_REDIRECTS = 3;
const MAX_RETRIES = 1; // 1 retry → up to 2 attempts (was 2; retries compound batch latency)
const RETRY_BASE_MS = 500;
const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 1 day

export interface FetchResult {
  body: string;
  status: number;
  finalUrl: string;
}

interface CacheEntry {
  body: string;
  status: number;
  finalUrl: string;
  at: number;
}

// Per-URL body cache, 1-day expiry. Key normalises the path the same way
// visited keys do (strip trailing slash; query + fragment already dropped
// upstream) so `/x` and `/x/` share an entry.
const bodyCache = new Map<string, CacheEntry>();

function cacheKey(url: string): string {
  try {
    const u = new URL(url);
    u.search = "";
    u.hash = "";
    u.pathname = normalizePath(u.pathname);
    return u.toString();
  } catch {
    return url;
  }
}

// Retry only on timeouts / connection failures (never on SSRF blocks, never on
// HTTP error statuses — those are returned to the caller as-is).
function isRetryable(err: unknown): boolean {
  if (err instanceof SsrfError) return false;
  const e = err as { name?: string };
  if (e?.name === "TimeoutError" || e?.name === "AbortError") return true;
  // undici/fetch surfaces network failures as a TypeError ("fetch failed").
  if (err instanceof TypeError) return true;
  return false;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export interface FetchOptions {
  userAgent?: string;
  timeoutMs?: number;
  /** Crawl-level abort signal — when fired, aborts in-flight requests immediately. */
  crawlSignal?: AbortSignal;
}

// ── Body reading with hard deadline ──────────────────────────────────────────
//
// Node.js undici applies an AbortSignal to the *request* phase. Once safeFetch
// returns a Response (headers received), the signal is no longer reliably wired
// to body streaming — res.text() can hang indefinitely even after the signal
// fires. This helper wraps body reading in an explicit Promise.race so the
// per-request timeout and crawl-level budget both apply to TTLB, not just TTFB.
function readBodyWithTimeout(
  res: Response,
  timeoutMs: number,
  crawlSignal?: AbortSignal,
): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    let abortHandler: (() => void) | null = null;

    const cleanup = () => {
      if (timer !== null) { clearTimeout(timer); timer = null; }
      if (abortHandler && crawlSignal) {
        crawlSignal.removeEventListener("abort", abortHandler);
        abortHandler = null;
      }
    };

    const fail = (err: Error) => {
      cleanup();
      res.body?.cancel().catch(() => {});
      reject(err);
    };

    // Hard wall — fires if body read takes longer than the per-request budget.
    timer = setTimeout(
      () => fail(Object.assign(new Error("body read timed out"), { name: "TimeoutError" })),
      timeoutMs,
    );

    // Immediate check in case crawlSignal already fired before we got here.
    if (crawlSignal?.aborted) {
      fail(Object.assign(new Error("crawl aborted"), { name: "AbortError" }));
      return;
    }

    if (crawlSignal) {
      abortHandler = () =>
        fail(Object.assign(new Error("crawl aborted"), { name: "AbortError" }));
      crawlSignal.addEventListener("abort", abortHandler, { once: true });
    }

    res.text().then(
      (text) => { cleanup(); resolve(text); },
      (err: unknown) => { cleanup(); reject(err); },
    );
  });
}

export async function fetchPage(
  url: string,
  opts: FetchOptions = {},
): Promise<FetchResult> {
  const key = cacheKey(url);
  const cached = bodyCache.get(key);
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) {
    return { body: cached.body, status: cached.status, finalUrl: cached.finalUrl };
  }

  const ua = opts.userAgent ?? DEFAULT_UA;
  const timeoutMs = opts.timeoutMs ?? TIMEOUT_MS;

  let attempt = 0;
  while (true) {
    if (opts.crawlSignal?.aborted) throw new Error("crawl deadline exceeded");

    // Combine the per-request timeout with the crawl-level deadline so whichever
    // fires first aborts the fetch. AbortSignal.any requires Node 20.3+.
    const signal = opts.crawlSignal
      ? AbortSignal.any([AbortSignal.timeout(timeoutMs), opts.crawlSignal])
      : AbortSignal.timeout(timeoutMs);

    try {
      const res = await safeFetch(url, { headers: { "User-Agent": ua }, signal }, MAX_REDIRECTS);

      // Bail out immediately if the crawl budget fired while safeFetch was running
      // (e.g. during a DNS re-check on a redirect hop, which doesn't take the signal).
      if (opts.crawlSignal?.aborted) {
        res.body?.cancel().catch(() => {});
        throw Object.assign(new Error("crawl aborted"), { name: "AbortError" });
      }

      const body = await readBodyWithTimeout(res, timeoutMs, opts.crawlSignal);
      const finalUrl = res.url || url;
      bodyCache.set(key, { body, status: res.status, finalUrl, at: Date.now() });
      return { body, status: res.status, finalUrl };
    } catch (err) {
      // Never retry if the crawl budget expired — bail out fast.
      if (attempt < MAX_RETRIES && isRetryable(err) && !opts.crawlSignal?.aborted) {
        await sleep(RETRY_BASE_MS * 2 ** attempt);
        attempt++;
        continue;
      }
      throw err;
    }
  }
}

/** Test/maintenance helper — clears the in-memory body cache. */
export function clearBodyCache(): void {
  bodyCache.clear();
}
