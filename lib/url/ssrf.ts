import dns from "node:dns/promises";
import net from "node:net";

const MAX_REDIRECTS = 5;

export class SsrfError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SsrfError";
  }
}

// ── IP range checks (pure — unit-testable without DNS) ───────────────────────

// Returns a human-readable reason string if the IP is blocked, null if safe.
export function blockedReason(ip: string): string | null {
  if (net.isIPv4(ip)) return blockedReasonV4(ip);
  if (net.isIPv6(ip)) return blockedReasonV6(ip);
  return `unrecognised IP format: ${ip}`;
}

function blockedReasonV4(ip: string): string | null {
  const [a, b] = ip.split(".").map(Number);
  if (a === 127) return "loopback (127.x.x.x)";
  if (a === 10) return "private (10.x.x.x)";
  if (a === 172 && b >= 16 && b <= 31) return "private (172.16–31.x.x)";
  if (a === 192 && b === 168) return "private (192.168.x.x)";
  if (a === 169 && b === 254) return "link-local / cloud metadata (169.254.x.x)";
  if (a === 0) return "unspecified (0.x.x.x)";
  if (a === 255) return "broadcast";
  if (a >= 224 && a <= 239) return "multicast (224–239.x.x.x)";
  if (a >= 240) return "reserved (240+.x.x.x)";
  return null;
}

function blockedReasonV6(ip: string): string | null {
  const lo = ip.toLowerCase();
  if (lo === "::1") return "loopback (::1)";
  if (lo === "::") return "unspecified (::)";
  // Link-local fe80::/10 → covers fe80–febf
  if (/^fe[89ab]/i.test(lo)) return "link-local (fe80::/10)";
  // Unique local fc00::/7 → fc and fd prefixes
  if (/^f[cd]/i.test(lo)) return "unique local (fc00::/7)";
  // Multicast ff00::/8
  if (/^ff/i.test(lo)) return "multicast (ff00::/8)";
  return null;
}

// ── DNS resolution + IP check ─────────────────────────────────────────────────

// Resolves hostname → IP, throws SsrfError if the IP is in a blocked range.
// Uses dns.lookup (OS resolver) which matches what Node's http stack uses.
export async function assertSafeHost(hostname: string): Promise<string> {
  let address: string;
  try {
    const result = await dns.lookup(hostname, { family: 0 });
    address = result.address;
  } catch (e) {
    throw new SsrfError(
      `DNS lookup failed for "${hostname}": ${(e as Error).message}`,
    );
  }
  const reason = blockedReason(address);
  if (reason) {
    throw new SsrfError(
      `Blocked: "${hostname}" resolves to ${address} — ${reason}`,
    );
  }
  return address;
}

// Parses, protocol-checks, and DNS-validates a full URL string.
export async function assertSafeUrl(url: string): Promise<void> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new SsrfError(`Invalid URL: "${url}"`);
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new SsrfError(
      `Blocked protocol "${parsed.protocol}" — only http/https allowed`,
    );
  }
  await assertSafeHost(parsed.hostname);
}

// ── Safe fetch — re-validates resolved IP after every redirect ────────────────
//
// The classic SSRF bypass: attacker registers a hostname that initially resolves
// to a public IP (passes the check), then immediately switches DNS to an
// internal IP before the actual HTTP connection. Re-checking after each redirect
// also catches servers that redirect to internal destinations.

export async function safeFetch(
  url: string,
  init?: RequestInit,
  maxRedirects = MAX_REDIRECTS,
): Promise<Response> {
  await assertSafeUrl(url);

  let currentUrl = url;
  let hops = 0;

  while (true) {
    const res = await fetch(currentUrl, { ...init, redirect: "manual" });

    if (res.status >= 300 && res.status < 400) {
      if (hops >= maxRedirects) {
        throw new SsrfError(`Too many redirects (max ${maxRedirects})`);
      }
      const location = res.headers.get("location");
      if (!location) {
        throw new SsrfError(
          `Redirect response missing Location header from "${currentUrl}"`,
        );
      }
      // Resolve relative Location values against the current URL.
      const next = new URL(location, currentUrl).href;
      // Critical: re-validate the redirect target before following.
      await assertSafeUrl(next);
      currentUrl = next;
      hops++;
      continue;
    }

    return res;
  }
}
