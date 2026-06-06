import { validate, type ValidationResult } from "./validator";
import type { CuratedSection } from "@/lib/curate/curate";
import { SECTION_LABELS } from "@/lib/curate/curate";

export interface GenerateResult {
  content: string;
  validation: ValidationResult;
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
): GenerateResult {
  const lines: string[] = [];

  lines.push(`# ${siteTitle}`);

  if (siteDescription) {
    lines.push("");
    lines.push(`> ${siteDescription}`);
  }

  lines.push("");

  for (const section of sections) {
    if (section.pages.length === 0) continue;

    const label = SECTION_LABELS[section.heading];
    lines.push(`## ${label}`);
    lines.push("");

    for (const page of section.pages) {
      const desc = page.description ?? deriveDescription(page);
      const name = page.title || page.url;
      if (desc) {
        lines.push(`- [${name}](${page.url}): ${desc}`);
      } else {
        lines.push(`- [${name}](${page.url})`);
      }
    }

    lines.push("");
  }

  const content = lines.join("\n").trimEnd() + "\n";
  const validation = validate(content);

  return { content, validation, mode: "fallback" };
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
