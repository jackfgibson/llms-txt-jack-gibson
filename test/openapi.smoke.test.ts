import { describe, it, expect } from "vitest";
import { getOpenApiDocument } from "../lib/api/openapi";

describe("openapi document", () => {
  it("generates without throwing and includes every /api route", () => {
    const doc = getOpenApiDocument();
    const paths = Object.keys(doc.paths ?? {});

    const expected = [
      ["/api/sites", "post"],
      ["/api/sites/{id}", "get"],
      ["/api/sites/{id}/crawl", "post"],
      ["/api/sites/{id}/generation", "get"],
      ["/api/sites/{id}/insights", "get"],
      ["/api/sites/{id}/insights", "post"],
      ["/api/crawls", "get"],
      ["/api/crawls/{id}", "get"],
      ["/api/crawls/{id}/change-event", "get"],
    ] as const;

    for (const [path, method] of expected) {
      expect(paths, `missing path ${path}`).toContain(path);
      expect(
        (doc.paths as Record<string, Record<string, unknown>>)[path][method],
        `missing ${method.toUpperCase()} ${path}`,
      ).toBeTruthy();
    }
  });
});
