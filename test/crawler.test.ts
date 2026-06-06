import { describe, it, expect } from "vitest";
import * as cheerio from "cheerio";
import { fetchRobots } from "@/lib/crawler/robots";

describe("fetchRobots — module wiring", () => {
  it("exports a function", () => {
    expect(typeof fetchRobots).toBe("function");
  });
});

describe("link extraction — cheerio", () => {
  it("resolves relative links against a base URL", () => {
    const $ = cheerio.load(`<a href="/about">About</a><a href="https://other.com/x">Ext</a>`);
    const links: string[] = [];
    $("a[href]").each((_, el) => {
      const href = $(el).attr("href");
      if (!href) return;
      try {
        links.push(new URL(href, "https://example.com").toString());
      } catch {
        // skip
      }
    });
    expect(links).toContain("https://example.com/about");
    expect(links).toContain("https://other.com/x");
  });

  it("ignores anchors with no href", () => {
    const $ = cheerio.load(`<a>No href</a><a href="/ok">OK</a>`);
    const links: string[] = [];
    $("a[href]").each((_, el) => {
      const href = $(el).attr("href");
      if (href) links.push(href);
    });
    expect(links).toEqual(["/ok"]);
  });

  it("strips fragments when resolving", () => {
    const href = "/page#section";
    const u = new URL(href, "https://example.com");
    u.hash = "";
    expect(u.toString()).toBe("https://example.com/page");
  });
});
