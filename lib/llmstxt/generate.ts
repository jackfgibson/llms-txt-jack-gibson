import type { CuratedSection } from "@/lib/curate/curate";

export interface GenerateResult {
  content: string;
  mode: "llm" | "fallback";
}

/**
 * Builds a spec-valid llms.txt from curated sections.
 * Uses pre-computed descriptions when available; falls back to
 * metaDescription → first sentence of mainText → bare title.
 */
export function generateFallback(
  siteTitle: string,
  siteDescription: string | null,
  sections: CuratedSection[],
  opts?: { keyPoints?: string[] },
): GenerateResult {
  const lines: string[] = [];

  lines.push(`# ${siteTitle}`);

  if (siteDescription) {
    lines.push("");
    lines.push(`> ${siteDescription}`);
    if (opts?.keyPoints?.length) {
      lines.push("");
      for (const kp of opts.keyPoints) {
        lines.push(`- ${kp}`);
      }
    }
  }

  lines.push("");

  for (const section of sections) {
    if (section.pages.length === 0) continue;

    lines.push(`## ${section.heading}`);
    lines.push("");

    for (const page of section.pages) {
      const desc = page.description ?? deriveDescription(page);
      const name = cleanTitle(page.title || urlToTitle(page.url), siteTitle);
      if (desc) {
        lines.push(`- [${name}](${page.url}): ${desc}`);
      } else {
        lines.push(`- [${name}](${page.url})`);
      }
    }

    lines.push("");
  }

  const content = lines.join("\n").trimEnd() + "\n";
  return { content, mode: "fallback" };
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Strip common page-title suffixes that repeat the brand name.
// e.g. "Men's Shoes. Nike.com" → "Men's Shoes"
//      "Help Center | Nike Help" → "Help Center"
//      "Getting Started - Vercel" → "Getting Started"
function cleanTitle(title: string, siteTitle: string): string {
  if (!siteTitle) return title;
  const name = escapeRegex(siteTitle);
  let t = title;
  // ". Nike.com" or ". Nike" at end
  t = t.replace(new RegExp(`[.·]\\s*${name}(\\.[a-z]{2,6})?\\s*$`, "i"), "").trim();
  // " | Nike Help" or " | Nike" (and anything after) at end
  t = t.replace(new RegExp(`\\s*\\|\\s*${name}.*$`, "i"), "").trim();
  // " - Nike" or " — Nike" at end
  t = t.replace(new RegExp(`\\s*[-–—]\\s*${name}(\\.[a-z]{2,6})?\\s*$`, "i"), "").trim();
  return t || title;
}

function urlToTitle(url: string): string {
  try {
    const segment = new URL(url).pathname
      .split("/")
      .filter(Boolean)
      .pop() ?? "";
    if (!segment) return url;
    return segment.replace(/[-_]/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
  } catch {
    return url;
  }
}

function deriveDescription(page: {
  metaDescription: string | null;
  mainText: string | null;
}): string | null {
  if (page.metaDescription?.trim()) {
    return page.metaDescription.trim();
  }
  if (page.mainText?.trim()) {
    // First sentence, capped at 160 chars.
    const sentence = page.mainText.split(/(?<=[.!?])\s+/)[0]?.trim() ?? "";
    return sentence.length > 0
      ? sentence.slice(0, 160) + (sentence.length > 160 ? "…" : "")
      : null;
  }
  return null;
}
