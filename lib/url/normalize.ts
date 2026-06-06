import { SsrfError } from "./ssrf";

// Normalises a user-supplied URL to a canonical origin string stored in
// sites.url. Throws if the URL is unparseable or not http/https.
export function normalizeOrigin(raw: string): string {
  let parsed: URL;
  try {
    // Prepend https:// if the user omitted the scheme.
    const withScheme = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
    parsed = new URL(withScheme);
  } catch {
    throw new SsrfError(`Cannot parse URL: "${raw}"`);
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new SsrfError(`Only http/https URLs are supported, got "${parsed.protocol}"`);
  }
  // origin = scheme + "://" + host (includes port if non-default), lowercased.
  return parsed.origin.toLowerCase();
}

// Derives a URL-safe slug from an origin, e.g. "https://example.com" → "example-com".
export function originToSlug(origin: string): string {
  return origin
    .replace(/^https?:\/\//, "")
    .replace(/[^a-z0-9]+/gi, "-")
    .replace(/^-|-$/g, "")
    .toLowerCase();
}
