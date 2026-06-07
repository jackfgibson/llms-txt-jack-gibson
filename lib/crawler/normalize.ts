// URL normalisation helpers — HOW_TO_CRAWL.md §4 "URL normalization helpers".
// These MUST match the reference behaviour exactly: same-page dedup is
// scheme/www/trailing-slash agnostic, and query strings + fragments are
// stripped before a URL is ever crawled or used as a cache/visited key.

/**
 * Trim; if there's no http(s):// prefix prepend `${baseScheme}://`; parse; drop
 * query string + fragment; stringify. On parse error, return the raw string.
 */
export function normalizeUrl(url: string, baseScheme = "https"): string {
  const trimmed = url.trim();
  const withScheme = /^https?:\/\//i.test(trimmed)
    ? trimmed
    : `${baseScheme}://${trimmed}`;
  try {
    const u = new URL(withScheme);
    u.search = "";
    u.hash = "";
    return u.toString();
  } catch {
    return trimmed;
  }
}

/** Strip a leading `www.` so `figma.com` === `www.figma.com`. */
export function normalizeHost(host: string): string {
  return host.replace(/^www\./i, "").toLowerCase();
}

/** Empty/`"/"` → `"/"`; otherwise strip a single trailing slash. */
export function normalizePath(path: string): string {
  if (!path || path === "/") return "/";
  return path.replace(/\/$/, "");
}

/**
 * Scheme-agnostic visited key: `normalizeHost(host) + normalizePath(path)`.
 * So http/https, www/non-www, and trailing-slash variants all count as one
 * visit. On parse error, falls back to the raw URL.
 */
export function visitedKey(url: string): string {
  try {
    const u = new URL(url);
    return normalizeHost(u.hostname) + normalizePath(u.pathname);
  } catch {
    return url;
  }
}

/**
 * True iff `url` is http(s) AND its host (www-normalised) matches `baseHost`
 * (also www-normalised).
 */
export function sameDomain(url: string, baseHost: string): boolean {
  if (!/^https?:\/\//i.test(url)) return false;
  try {
    const u = new URL(url);
    return normalizeHost(u.hostname) === normalizeHost(baseHost);
  } catch {
    return false;
  }
}
