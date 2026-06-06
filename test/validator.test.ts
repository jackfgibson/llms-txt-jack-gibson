import { describe, it, expect } from "vitest";
import { validate } from "@/lib/llmstxt/validator";

// ── Valid fixtures ────────────────────────────────────────────────────────────

const MINIMAL_VALID = `# My Site`;

const FULL_VALID = `# Acme Docs

> The fastest way to build reliable APIs.

Acme provides a suite of developer tools for building production-ready services.

## Guides

- [Getting Started](https://acme.com/docs/start): Quick setup in 5 minutes
- [Authentication](https://acme.com/docs/auth): API key and OAuth flows

## API Reference

- [REST API](https://acme.com/api)
- [SDKs](https://acme.com/sdks)

## Optional

- [Legal](https://acme.com/legal)
- [Contact](https://acme.com/contact)
`;

const NO_BLOCKQUOTE = `# My Site

## Docs

- [Intro](https://example.com/intro)
`;

// ── Broken fixtures ───────────────────────────────────────────────────────────

const NO_H1 = `## Some Section

- [Link](https://example.com)
`;

const MULTIPLE_H1 = `# First Title

# Second Title

## Section

- [Link](https://example.com)
`;

const BARE_URL = `# My Site

## Docs

- https://example.com/bare-url
`;

const MALFORMED_BULLET = `# My Site

## Docs

- not a link at all just text
- [](https://example.com)
`;

const NAMELESS_LINK = `# My Site

## Docs

- [](https://example.com/nameless)
`;

const EMPTY_DOC = ``;

const ONLY_BLANK_LINES = `


`;

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("validate — valid inputs", () => {
  it("accepts a minimal single-H1 document", () => {
    const r = validate(MINIMAL_VALID);
    expect(r.valid).toBe(true);
    expect(r.errors).toHaveLength(0);
    // No H2 sections → 1 warning → score 95 (valid but incomplete)
    expect(r.score).toBeGreaterThanOrEqual(90);
  });

  it("accepts a full well-formed document", () => {
    const r = validate(FULL_VALID);
    expect(r.valid).toBe(true);
    expect(r.errors).toHaveLength(0);
    expect(r.score).toBeGreaterThanOrEqual(90);
  });

  it("accepts a document with no blockquote", () => {
    const r = validate(NO_BLOCKQUOTE);
    expect(r.valid).toBe(true);
    expect(r.errors).toHaveLength(0);
  });

  it("recognises the Optional section without errors", () => {
    const r = validate(FULL_VALID);
    expect(r.valid).toBe(true);
    expect(r.errors).toHaveLength(0);
  });

  it("validates its own output (self-referential check)", () => {
    const r = validate(FULL_VALID);
    expect(r.valid).toBe(true);
  });
});

describe("validate — error cases", () => {
  it("rejects an empty document", () => {
    const r = validate(EMPTY_DOC);
    expect(r.valid).toBe(false);
    expect(r.errors.length).toBeGreaterThan(0);
    expect(r.score).toBe(0);
  });

  it("rejects a document with only blank lines", () => {
    const r = validate(ONLY_BLANK_LINES);
    expect(r.valid).toBe(false);
    expect(r.score).toBe(0);
  });

  it("rejects a document that does not start with H1", () => {
    const r = validate(NO_H1);
    expect(r.valid).toBe(false);
    expect(r.errors.some((e) => /H1/i.test(e))).toBe(true);
    expect(r.score).toBe(0);
  });

  it("flags multiple H1 headings", () => {
    const r = validate(MULTIPLE_H1);
    expect(r.valid).toBe(false);
    expect(r.errors.some((e) => /multiple h1/i.test(e))).toBe(true);
  });

  it("flags bare URLs in bullet lists", () => {
    const r = validate(BARE_URL);
    expect(r.valid).toBe(false);
    expect(r.errors.some((e) => /bare url/i.test(e))).toBe(true);
  });

  it("flags malformed list items", () => {
    const r = validate(MALFORMED_BULLET);
    expect(r.valid).toBe(false);
    expect(r.errors.some((e) => /malformed/i.test(e))).toBe(true);
  });

  it("flags nameless links", () => {
    const r = validate(NAMELESS_LINK);
    expect(r.valid).toBe(false);
    expect(r.errors.some((e) => /nameless/i.test(e))).toBe(true);
  });
});

describe("validate — scoring", () => {
  it("returns score 100 for a perfect document", () => {
    expect(validate(FULL_VALID).score).toBe(100);
  });

  it("reduces score for each error", () => {
    const withOneError = validate(BARE_URL);
    expect(withOneError.score).toBeLessThan(100);
  });

  it("score is always 0–100", () => {
    for (const doc of [EMPTY_DOC, NO_H1, FULL_VALID, BARE_URL, MALFORMED_BULLET]) {
      const { score } = validate(doc);
      expect(score).toBeGreaterThanOrEqual(0);
      expect(score).toBeLessThanOrEqual(100);
    }
  });
});
