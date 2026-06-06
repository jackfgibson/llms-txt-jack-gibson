import { z } from "zod";
import { getClient } from "./client";

const OutputSchema = z.object({
  description: z.string().min(10).max(300),
  provenance: z.string().min(5).max(500),
});

export interface PageDescriptionResult {
  description: string;
  provenance: string;
}

/**
 * Uses Claude tool-use to generate a grounded 1-2 sentence description and
 * a provenance excerpt for a single page. Returns null on total failure so
 * callers can fall back to meta/first-sentence derivation.
 */
export async function describePage(page: {
  url: string;
  title: string | null;
  h1?: string | null;
  metaDescription: string | null;
  mainText: string | null;
}): Promise<PageDescriptionResult | null> {
  const content = buildContent(page);
  if (!content.trim()) return null;

  const client = getClient();

  const prompt = `You are writing a description for a page entry in an llms.txt file — a machine-readable site index for AI systems.

URL: ${page.url}
Title: ${page.title || page.h1 || "(unknown)"}

Content:
${content}

Write a 1-2 sentence description of what this page contains, grounded ONLY in the content above. Never invent facts not present in the content. Also return the exact excerpt (20-100 words) from the content that you based the description on.`;

  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const response = await client.messages.create({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 512,
        tools: [
          {
            name: "describe_page",
            description: "Describe a page for inclusion in an llms.txt file.",
            input_schema: {
              type: "object" as const,
              properties: {
                description: {
                  type: "string",
                  description:
                    "1-2 sentence description (max 200 chars) grounded strictly in the page content.",
                },
                provenance: {
                  type: "string",
                  description:
                    "Exact excerpt (20-100 words) from the content that backs the description.",
                },
              },
              required: ["description", "provenance"],
            },
          },
        ],
        tool_choice: { type: "tool" as const, name: "describe_page" },
        messages: [{ role: "user", content: prompt }],
      });

      const toolBlock = response.content.find((b) => b.type === "tool_use");
      if (!toolBlock || toolBlock.type !== "tool_use") continue;

      const parsed = OutputSchema.safeParse(toolBlock.input);
      if (parsed.success) return parsed.data;
    } catch {
      // Retry once, then give up
    }
  }

  return null;
}

function buildContent(page: {
  title: string | null;
  h1?: string | null;
  metaDescription: string | null;
  mainText: string | null;
}): string {
  const parts: string[] = [];
  if (page.h1 && page.h1 !== page.title) parts.push(`# ${page.h1}`);
  if (page.metaDescription) parts.push(page.metaDescription);
  if (page.mainText) parts.push(page.mainText.slice(0, 2000));
  return parts.join("\n\n");
}
