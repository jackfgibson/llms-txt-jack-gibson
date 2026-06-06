// Validates generated llms.txt output against the llmstxt.org spec.
// Spec summary: https://llmstxt.org
//
// Structure:
//   # H1 (required, must be first line/non-blank)
//   > optional blockquote immediately after H1
//   free-form detail paragraphs (before any H2)
//   ## H2 section   ← each is a bullet list of [name](url) links
//   ## Optional      ← semantically skippable section

export interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
  score: number; // 0–100
}

// A parsed link item from a bullet list line.
interface LinkItem {
  name: string;
  url: string;
  notes?: string;
}

const LINK_RE = /^\[([^\]]+)\]\(([^)]+)\)(?::\s*(.+))?$/;
const BARE_URL_RE = /^https?:\/\//;
const H1_RE = /^#\s+(.+)/;
const H2_RE = /^##\s+(.+)/;
const HN_RE = /^#{3,}\s+/; // h3+ inside a section = flag
const BLOCKQUOTE_RE = /^>\s*/;
const BULLET_RE = /^[-*]\s+(.+)/;

export function validate(content: string): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  const lines = content.split("\n");
  let i = 0;

  // Skip leading blank lines only to find the first non-blank.
  while (i < lines.length && lines[i].trim() === "") i++;

  // ── Rule 1: First non-blank line must be an H1 ───────────────────────────
  if (i >= lines.length) {
    return { valid: false, errors: ["Document is empty"], warnings, score: 0 };
  }

  const h1Match = H1_RE.exec(lines[i]);
  if (!h1Match) {
    errors.push(
      `First non-blank line must be an H1 (# Title). Found: "${lines[i].slice(0, 60)}"`,
    );
    return { valid: false, errors, warnings, score: 0 };
  }

  const siteTitle = h1Match[1].trim();
  if (!siteTitle) errors.push("H1 title is empty");
  i++;

  // ── Rule 2: Optional blockquote immediately after H1 ─────────────────────
  // Skip blank lines between H1 and potential blockquote.
  while (i < lines.length && lines[i].trim() === "") i++;
  if (i < lines.length && BLOCKQUOTE_RE.test(lines[i])) {
    const quote = lines[i].replace(BLOCKQUOTE_RE, "").trim();
    if (!quote) warnings.push("Blockquote after H1 is empty");
    i++;
  }

  // ── Rule 3: Free-form detail before first H2 is allowed ──────────────────
  // Advance until we hit the first H2 (or end of document).
  while (i < lines.length && !H2_RE.test(lines[i])) {
    const line = lines[i].trim();
    if (H1_RE.test(line)) {
      errors.push(
        `Multiple H1 headings found. Only one H1 is allowed (line ${i + 1}).`,
      );
    }
    if (HN_RE.test(line)) {
      warnings.push(
        `Sub-H2 heading found before first section (line ${i + 1}): "${line.slice(0, 60)}"`,
      );
    }
    i++;
  }

  // ── Rule 4: H2 sections, each must be a bullet list of valid links ────────
  let sectionCount = 0;
  let hasOptionalSection = false;
  let totalLinks = 0;
  let validLinks = 0;

  while (i < lines.length) {
    const line = lines[i];

    if (H1_RE.test(line.trim())) {
      errors.push(`Multiple H1 headings (line ${i + 1}). Only one allowed.`);
      i++;
      continue;
    }

    const h2Match = H2_RE.exec(line);
    if (!h2Match) {
      i++;
      continue;
    }

    // Found an H2 section.
    const sectionName = h2Match[1].trim();
    sectionCount++;
    if (sectionName.toLowerCase() === "optional") hasOptionalSection = true;
    i++;

    // Collect the bullet list for this section.
    let sectionHasLinks = false;
    while (i < lines.length && !H2_RE.test(lines[i])) {
      const sLine = lines[i].trim();
      i++;

      if (sLine === "") continue;

      if (HN_RE.test(sLine)) {
        warnings.push(
          `Sub-H2 heading inside section "${sectionName}" (line ${i}): "${sLine.slice(0, 60)}"`,
        );
        continue;
      }

      const bulletMatch = BULLET_RE.exec(sLine);
      if (!bulletMatch) {
        // Non-bullet, non-blank, non-heading inside a section.
        if (!BLOCKQUOTE_RE.test(sLine)) {
          warnings.push(
            `Non-list content inside section "${sectionName}" (line ${i}): "${sLine.slice(0, 60)}"`,
          );
        }
        continue;
      }

      // It's a bullet item — validate the link.
      totalLinks++;
      const itemText = bulletMatch[1].trim();

      if (BARE_URL_RE.test(itemText)) {
        errors.push(
          `Bare URL in section "${sectionName}" (line ${i}): wrap as [name](url)`,
        );
        continue;
      }

      const linkMatch = LINK_RE.exec(itemText);
      if (!linkMatch) {
        errors.push(
          `Malformed list item in section "${sectionName}" (line ${i}): "${itemText.slice(0, 80)}"`,
        );
        continue;
      }

      const parsed: LinkItem = {
        name: linkMatch[1].trim(),
        url: linkMatch[2].trim(),
        notes: linkMatch[3]?.trim(),
      };

      if (!parsed.name) {
        errors.push(
          `Nameless link in section "${sectionName}" (line ${i}): "${itemText.slice(0, 80)}"`,
        );
      } else if (!parsed.url) {
        errors.push(
          `Link with empty URL in section "${sectionName}" (line ${i}): "${itemText.slice(0, 80)}"`,
        );
      } else {
        validLinks++;
        sectionHasLinks = true;
      }
    }

    if (!sectionHasLinks) {
      warnings.push(`Section "${sectionName}" has no valid link items`);
    }
  }

  if (sectionCount === 0) {
    warnings.push("No H2 sections found — a valid llms.txt should have at least one");
  }

  // ── Score ─────────────────────────────────────────────────────────────────
  // Base 100, deduct for errors (-15 each, min 0) and warnings (-5 each).
  const rawScore = 100 - errors.length * 15 - warnings.length * 5;
  const score = Math.max(0, Math.min(100, rawScore));

  // Bonus metadata (non-scoring) — surface in warnings for transparency.
  if (hasOptionalSection) {
    // Acknowledge; not an error or warning.
  }
  if (totalLinks > 0 && validLinks / totalLinks < 0.5) {
    warnings.push(
      `More than half of bullet items are malformed (${validLinks}/${totalLinks} valid)`,
    );
  }

  const valid = errors.length === 0;
  return { valid, errors, warnings, score };
}
