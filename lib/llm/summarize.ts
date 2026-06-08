import { z } from "zod";
import { callWithTool, type LlmProvider } from "./call";

const OutputSchema = z.object({
  siteTitle: z.string().min(1).max(100),
  summary: z.string().min(10).max(400),
  keyPoints: z.string().optional(), // JSON array of strings e.g. ["Primary use cases: ...", ...]
  provenance: z.string().min(5).max(500),
});

export interface SiteSummaryResult {
  siteTitle: string;
  summary: string;
  keyPoints?: string[];
  provenance: string;
}

export async function generateSiteSummary(
  rawTitle: string,
  homeContent: string,
  aboutContent: string | null,
  provider?: LlmProvider,
): Promise<SiteSummaryResult | null> {
  const combined = [homeContent, aboutContent]
    .filter(Boolean)
    .join("\n\n---\n\n");
  if (!combined.trim()) return null;

  const prompt = `You are writing the header for an llms.txt file — a machine-readable site index for AI systems.

Raw site title (may contain noise like "| Company" or "Home - Brand"): ${rawTitle}

Home / about page content:
${combined.slice(0, 3000)}

Tasks:
1. Extract or clean the site/product name (strip " | Brand", "Home - ", taglines, etc.). This becomes the H1.
2. Write a 2-3 sentence summary of what the site/product does, grounded ONLY in the content above. Never invent facts.
3. Write 2-4 key bullet points (max 150 chars each) that highlight primary use cases, key content areas, notable integrations or sub-brands, or audience context. Return them as a JSON array of strings, e.g. ["Primary use cases: browsing products, managing orders", "Membership layer: sign-in tied to orders and perks"]. Keep each point factual and grounded in the content.
4. Return the exact excerpt (20-100 words) from the content that the summary is based on.`;

  try {
    const raw = await callWithTool(
      prompt,
      {
        name: "generate_summary",
        description: "Generate a site title and summary for an llms.txt header.",
        properties: {
          siteTitle: {
            type: "string",
            description:
              "Clean product/site name for the H1 — no taglines, no domain suffix, no ' | Brand' noise.",
          },
          summary: {
            type: "string",
            description:
              "1-2 sentence description of what the site does, grounded strictly in the provided content.",
          },
          keyPoints: {
            type: "string",
            description:
              'Optional JSON array of 2-4 short strings (max 150 chars each) highlighting primary use cases, key content areas, notable integrations/sub-brands, or audience — each grounded in the content. e.g. ["Primary use cases: browsing products, managing orders", "Membership layer tied to orders and perks"].',
          },
          provenance: {
            type: "string",
            description:
              "Exact excerpt (20-100 words) from the content that the summary is based on.",
          },
        },
        required: ["siteTitle", "summary", "provenance"],
      },
      provider,
    );

    if (!raw) return null;
    const parsed = OutputSchema.safeParse(raw);
    if (!parsed.success) return null;

    let keyPoints: string[] | undefined;
    if (parsed.data.keyPoints) {
      try {
        const arr = JSON.parse(parsed.data.keyPoints);
        if (Array.isArray(arr)) {
          keyPoints = arr.filter((s): s is string => typeof s === "string").slice(0, 4);
        }
      } catch {
        // ignore malformed JSON — key points are optional
      }
    }

    return { ...parsed.data, keyPoints };
  } catch {
    return null;
  }
}
