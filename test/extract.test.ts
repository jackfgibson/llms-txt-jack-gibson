import { describe, it, expect } from "vitest";
import { extractPage } from "@/lib/extract/extract";

const FULL_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
  <title>Acme Docs</title>
  <meta name="description" content="The best docs ever." />
  <meta property="og:title" content="Acme Docs OG" />
  <meta property="og:description" content="OG desc" />
  <link rel="canonical" href="https://example.com/docs" />
</head>
<body>
  <h1>Welcome to Acme</h1>
  <p>This is a real paragraph with enough text to not be a JS shell. It goes on and on with many words to ensure the body text length exceeds the 100 character threshold used for JS shell detection.</p>
  <p>Another paragraph with more content about our amazing product that developers love to use every day.</p>
</body>
</html>`;

const JS_SHELL_HTML = `<!DOCTYPE html>
<html>
<head><title>Loading</title></head>
<body><div id="root"></div></body>
</html>`;

describe("extractPage — metadata", () => {
  it("extracts title, metaDescription, lang, h1, canonical", () => {
    const r = extractPage(FULL_HTML, "https://example.com/docs");
    expect(r.title).toBe("Acme Docs");
    expect(r.metaDescription).toBe("The best docs ever.");
    expect(r.lang).toBe("en");
    expect(r.h1).toBe("Welcome to Acme");
    expect(r.canonical).toBe("https://example.com/docs");
  });

  it("extracts og tags as a flat map", () => {
    const r = extractPage(FULL_HTML, "https://example.com/docs");
    expect(r.og["title"]).toBe("Acme Docs OG");
    expect(r.og["description"]).toBe("OG desc");
  });
});

describe("extractPage — main content and hash", () => {
  it("produces non-null mainText and contentHash for a real page", () => {
    const r = extractPage(FULL_HTML, "https://example.com/docs");
    expect(r.mainText).toBeTruthy();
    expect(r.contentHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("produces the same hash for the same content", () => {
    const a = extractPage(FULL_HTML, "https://example.com/a");
    const b = extractPage(FULL_HTML, "https://example.com/b");
    expect(a.contentHash).toBe(b.contentHash);
  });

  it("produces different hashes for different content", () => {
    const altered = FULL_HTML.replace("Welcome to Acme", "Welcome to Beta");
    const a = extractPage(FULL_HTML, "https://example.com/docs");
    const b = extractPage(altered, "https://example.com/docs");
    expect(a.contentHash).not.toBe(b.contentHash);
  });
});

describe("extractPage — JS shell detection", () => {
  it("marks a JS shell as isJsShell = true", () => {
    const r = extractPage(JS_SHELL_HTML, "https://example.com/");
    expect(r.isJsShell).toBe(true);
  });

  it("marks a content-rich page as isJsShell = false", () => {
    const r = extractPage(FULL_HTML, "https://example.com/docs");
    expect(r.isJsShell).toBe(false);
  });
});

describe("extractPage — missing fields", () => {
  it("returns nulls for absent metadata", () => {
    const bare = `<html><body><p>${"x".repeat(200)}</p></body></html>`;
    const r = extractPage(bare, "https://example.com/");
    expect(r.title).toBeNull();
    expect(r.metaDescription).toBeNull();
    expect(r.lang).toBeNull();
    expect(r.h1).toBeNull();
    expect(r.canonical).toBeNull();
    expect(r.og).toEqual({});
  });
});
