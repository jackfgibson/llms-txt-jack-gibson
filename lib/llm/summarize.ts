import { z } from "zod";
import { getClient } from "./client";

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

/**
 * Uses Claude to produce a clean site title and 1-2 sentence summary for
 * the llms.txt H1 + blockquote, grounded in the home/about page content.
 * Returns null on failure so callers can fall back to raw title/meta.
 */
export async function generateSiteSummary(
  rawTitle: string,
  homeContent: string,
  aboutContent: string | null,
): Promise<SiteSummaryResult | null> {
  const combined = [homeContent, aboutContent]
    .filter(Boolean)
    .join("\n\n---\n\n");
  if (!combined.trim()) return null;

  const client = getClient();

  const prompt = `You are writing the header for an llms.txt file — a machine-readable site index for AI systems.

Raw site title (may contain noise like "| Company" or "Home - Brand"): ${rawTitle}

Home / about page content:
${combined.slice(0, 3000)}

Tasks:
1. Extract or clean the site/product name (strip " | Brand", "Home - ", taglines, etc.). This becomes the H1.
2. Write a 1-2 sentence summary of what the site/product does, grounded ONLY in the content above. Never invent facts.
3. Return the exact excerpt (20-100 words) from the content that the summary is based on.`;

  try {
    const response = await client.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 512,
      tools: [
        {
          name: "generate_summary",
          description: "Generate a site title and summary for an llms.txt header.",
          input_schema: {
            type: "object" as const,
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
        },
      ],
      tool_choice: { type: "tool" as const, name: "generate_summary" },
      messages: [{ role: "user", content: prompt }],
    });

    const toolBlock = response.content.find((b) => b.type === "tool_use");
    if (!toolBlock || toolBlock.type !== "tool_use") return null;

    const parsed = OutputSchema.safeParse(toolBlock.input);
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}
