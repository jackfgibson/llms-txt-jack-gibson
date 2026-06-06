import { z } from "zod";
import { callWithTool, type LlmProvider } from "./call";

const OutputSchema = z.object({
  siteTitle: z.string().min(1).max(100),
  summary: z.string().min(10).max(400),
  provenance: z.string().min(5).max(500),
});

export interface SiteSummaryResult {
  siteTitle: string;
  summary: string;
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
2. Write a 1-2 sentence summary of what the site/product does, grounded ONLY in the content above. Never invent facts.
3. Return the exact excerpt (20-100 words) from the content that the summary is based on.`;

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
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}
