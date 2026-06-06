import { describe, it, expect } from "vitest";
import { diffCrawls, isMeaningfulChange } from "../lib/monitor/diff";

describe("diffCrawls", () => {
  it("returns all as added when prev is empty", () => {
    const result = diffCrawls([], [
      { url: "https://a.com/", contentHash: "h1" },
      { url: "https://a.com/about", contentHash: "h2" },
    ]);
    expect(result.added).toEqual(["https://a.com/", "https://a.com/about"]);
    expect(result.removed).toEqual([]);
    expect(result.changed).toEqual([]);
    expect(result.unchanged).toEqual([]);
  });

  it("returns all as removed when next is empty", () => {
    const result = diffCrawls([
      { url: "https://a.com/", contentHash: "h1" },
    ], []);
    expect(result.added).toEqual([]);
    expect(result.removed).toEqual(["https://a.com/"]);
    expect(result.changed).toEqual([]);
  });

  it("detects unchanged pages", () => {
    const pages = [
      { url: "https://a.com/", contentHash: "h1" },
      { url: "https://a.com/about", contentHash: "h2" },
    ];
    const result = diffCrawls(pages, pages);
    expect(result.unchanged).toEqual(["https://a.com/", "https://a.com/about"]);
    expect(result.added).toEqual([]);
    expect(result.removed).toEqual([]);
    expect(result.changed).toEqual([]);
  });

  it("detects a changed page (same url, different hash)", () => {
    const result = diffCrawls(
      [{ url: "https://a.com/", contentHash: "old" }],
      [{ url: "https://a.com/", contentHash: "new" }],
    );
    expect(result.changed).toEqual(["https://a.com/"]);
    expect(result.unchanged).toEqual([]);
  });

  it("treats null hash as a distinct value (null !== null is false in JS)", () => {
    // Two pages with null hashes for the same URL should be treated as unchanged
    const result = diffCrawls(
      [{ url: "https://a.com/", contentHash: null }],
      [{ url: "https://a.com/", contentHash: null }],
    );
    expect(result.unchanged).toEqual(["https://a.com/"]);
    expect(result.changed).toEqual([]);
  });

  it("null hash → non-null hash is a change", () => {
    const result = diffCrawls(
      [{ url: "https://a.com/", contentHash: null }],
      [{ url: "https://a.com/", contentHash: "abc123" }],
    );
    expect(result.changed).toEqual(["https://a.com/"]);
  });

  it("mixed: added + removed + changed + unchanged in one diff", () => {
    const prev = [
      { url: "https://a.com/", contentHash: "h1" },
      { url: "https://a.com/about", contentHash: "h2" },
      { url: "https://a.com/old-page", contentHash: "h3" },
    ];
    const next = [
      { url: "https://a.com/", contentHash: "h1" },      // unchanged
      { url: "https://a.com/about", contentHash: "h2-new" }, // changed
      { url: "https://a.com/new-page", contentHash: "h4" }, // added
      // old-page removed
    ];
    const result = diffCrawls(prev, next);
    expect(result.unchanged).toEqual(["https://a.com/"]);
    expect(result.changed).toEqual(["https://a.com/about"]);
    expect(result.added).toEqual(["https://a.com/new-page"]);
    expect(result.removed).toEqual(["https://a.com/old-page"]);
  });
});

describe("isMeaningfulChange", () => {
  it("returns false when nothing changed", () => {
    expect(isMeaningfulChange({ added: [], removed: [], changed: [], unchanged: ["x"] })).toBe(false);
  });

  it("returns true when a page is added", () => {
    expect(isMeaningfulChange({ added: ["x"], removed: [], changed: [], unchanged: [] })).toBe(true);
  });

  it("returns true when a page is removed", () => {
    expect(isMeaningfulChange({ added: [], removed: ["x"], changed: [], unchanged: [] })).toBe(true);
  });

  it("returns true when a page is changed", () => {
    expect(isMeaningfulChange({ added: [], removed: [], changed: ["x"], unchanged: [] })).toBe(true);
  });
});
