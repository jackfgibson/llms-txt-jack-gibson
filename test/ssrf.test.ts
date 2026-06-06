import { describe, it, expect } from "vitest";
import { blockedReason, assertSafeUrl, SsrfError } from "@/lib/url/ssrf";
import { normalizeOrigin, originToSlug } from "@/lib/url/normalize";

// ── blockedReason — IPv4 (pure, no DNS) ──────────────────────────────────────

describe("blockedReason — IPv4", () => {
  it("blocks loopback 127.x.x.x", () => {
    expect(blockedReason("127.0.0.1")).toMatch(/loopback/);
    expect(blockedReason("127.255.255.255")).toMatch(/loopback/);
  });

  it("blocks private 10.x.x.x", () => {
    expect(blockedReason("10.0.0.1")).toMatch(/private/);
    expect(blockedReason("10.255.255.255")).toMatch(/private/);
  });

  it("blocks private 172.16–31.x.x and allows adjacent ranges", () => {
    expect(blockedReason("172.16.0.1")).toMatch(/private/);
    expect(blockedReason("172.31.255.255")).toMatch(/private/);
    expect(blockedReason("172.15.0.1")).toBeNull(); // just below range
    expect(blockedReason("172.32.0.1")).toBeNull(); // just above range
  });

  it("blocks private 192.168.x.x", () => {
    expect(blockedReason("192.168.0.1")).toMatch(/private/);
    expect(blockedReason("192.168.255.255")).toMatch(/private/);
  });

  it("blocks 169.254.169.254 (AWS/cloud metadata endpoint)", () => {
    expect(blockedReason("169.254.169.254")).toMatch(/link-local/);
  });

  it("blocks entire 169.254.0.0/16 link-local range", () => {
    expect(blockedReason("169.254.0.1")).toMatch(/link-local/);
    expect(blockedReason("169.254.255.255")).toMatch(/link-local/);
  });

  it("blocks unspecified 0.x.x.x", () => {
    expect(blockedReason("0.0.0.0")).toMatch(/unspecified/);
  });

  it("blocks broadcast 255.x.x.x", () => {
    expect(blockedReason("255.255.255.255")).toMatch(/broadcast/);
  });

  it("blocks multicast 224–239.x.x.x", () => {
    expect(blockedReason("224.0.0.1")).toMatch(/multicast/);
    expect(blockedReason("239.255.255.255")).toMatch(/multicast/);
  });

  it("blocks reserved 240+.x.x.x", () => {
    expect(blockedReason("240.0.0.1")).toMatch(/reserved/);
  });

  it("allows public IPs", () => {
    expect(blockedReason("1.1.1.1")).toBeNull();
    expect(blockedReason("8.8.8.8")).toBeNull();
    expect(blockedReason("93.184.216.34")).toBeNull(); // example.com
    expect(blockedReason("172.15.0.1")).toBeNull();
    expect(blockedReason("172.32.0.1")).toBeNull();
    expect(blockedReason("192.167.0.1")).toBeNull();
    expect(blockedReason("192.169.0.1")).toBeNull();
  });
});

// ── blockedReason — IPv6 (pure, no DNS) ──────────────────────────────────────

describe("blockedReason — IPv6", () => {
  it("blocks loopback ::1", () => {
    expect(blockedReason("::1")).toMatch(/loopback/);
  });

  it("blocks unspecified ::", () => {
    expect(blockedReason("::")).toMatch(/unspecified/);
  });

  it("blocks link-local fe80::/10 (fe80–febf)", () => {
    expect(blockedReason("fe80::1")).toMatch(/link-local/);
    expect(blockedReason("FE80::1")).toMatch(/link-local/); // case insensitive
    expect(blockedReason("feb0::1")).toMatch(/link-local/);
  });

  it("blocks unique-local fc00::/7 (fc and fd)", () => {
    expect(blockedReason("fc00::1")).toMatch(/unique local/);
    expect(blockedReason("fd12:3456::1")).toMatch(/unique local/);
  });

  it("blocks multicast ff00::/8", () => {
    expect(blockedReason("ff02::1")).toMatch(/multicast/);
  });

  it("allows public IPv6", () => {
    expect(blockedReason("2001:db8::1")).toBeNull();
    expect(blockedReason("2606:4700:4700::1111")).toBeNull(); // Cloudflare DNS
  });
});

// ── assertSafeUrl — protocol + DNS integration ───────────────────────────────

describe("assertSafeUrl", () => {
  it("rejects non-http/https protocols", async () => {
    await expect(assertSafeUrl("file:///etc/passwd")).rejects.toThrow(SsrfError);
    await expect(assertSafeUrl("ftp://example.com/")).rejects.toThrow(SsrfError);
    await expect(assertSafeUrl("javascript:alert(1)")).rejects.toThrow(SsrfError);
  });

  it("rejects invalid URLs", async () => {
    await expect(assertSafeUrl("not a url")).rejects.toThrow(SsrfError);
    await expect(assertSafeUrl("")).rejects.toThrow(SsrfError);
  });

  it("rejects localhost (resolves to loopback)", async () => {
    await expect(assertSafeUrl("http://localhost/")).rejects.toThrow(SsrfError);
  });

  it("rejects 127.0.0.1 directly in URL", async () => {
    await expect(assertSafeUrl("http://127.0.0.1/")).rejects.toThrow(SsrfError);
  });

  it("rejects cloud metadata IP in URL", async () => {
    await expect(assertSafeUrl("http://169.254.169.254/latest/meta-data/")).rejects.toThrow(SsrfError);
  });

  it("rejects private IP directly in URL", async () => {
    await expect(assertSafeUrl("http://192.168.1.1/")).rejects.toThrow(SsrfError);
    await expect(assertSafeUrl("http://10.0.0.1/")).rejects.toThrow(SsrfError);
  });
});

// ── normalizeOrigin ───────────────────────────────────────────────────────────

describe("normalizeOrigin", () => {
  it("returns lowercase origin for a full URL", () => {
    expect(normalizeOrigin("https://Example.COM/some/path?q=1")).toBe("https://example.com");
  });

  it("prepends https:// when scheme is omitted", () => {
    expect(normalizeOrigin("example.com")).toBe("https://example.com");
  });

  it("preserves http:// scheme", () => {
    expect(normalizeOrigin("http://example.com/path")).toBe("http://example.com");
  });

  it("includes non-default port", () => {
    expect(normalizeOrigin("https://example.com:8080/path")).toBe("https://example.com:8080");
  });

  it("throws on unparseable input", () => {
    expect(() => normalizeOrigin("://bad")).toThrow();
  });
});

// ── originToSlug ──────────────────────────────────────────────────────────────

describe("originToSlug", () => {
  it("converts origin to a slug", () => {
    expect(originToSlug("https://example.com")).toBe("example-com");
    expect(originToSlug("https://my.site.io")).toBe("my-site-io");
    expect(originToSlug("https://example.com:8080")).toBe("example-com-8080");
  });
});
