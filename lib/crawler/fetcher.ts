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
const TIMEOUT_MS = 30_000; // total request timeout
const MAX_REDIRECTS = 3;
const MAX_RETRIES = 2; // 2 retries → up to 3 attempts
const RETRY_BASE_MS = 500; // 0.5s, then 1s (2× backoff)
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
    try {
      const res = await safeFetch(
        url,
        { headers: { "User-Agent": ua }, signal: AbortSignal.timeout(timeoutMs) },
        MAX_REDIRECTS,
      );
      const body = await res.text();
      const finalUrl = res.url || url;
      bodyCache.set(key, { body, status: res.status, finalUrl, at: Date.now() });
      return { body, status: res.status, finalUrl };
    } catch (err) {
      if (attempt < MAX_RETRIES && isRetryable(err)) {
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
