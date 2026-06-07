import { z } from "zod";
import type { LlmProvider } from "./call";

export interface LlmGroupSection {
  heading: string;
  urls: string[];
}

const SectionsSchema = z.object({
  sections: z.array(
    z.object({
      heading: z.string().min(1).max(60),
      urls: z.array(z.string().url()),
    }),
  ),
});

/**
 * Asks the LLM to group crawled pages into meaningful named sections.
 * Returns null if the provider key is missing or the call fails — callers
 * must fall back to the classifier-based sections in that case.
 */
export async function groupPagesWithLlm(
  pages: Array<{ url: string; title: string; description: string | null }>,
  provider: LlmProvider,
): Promise<LlmGroupSection[] | null> {
  if (pages.length === 0) return null;

  const keyPresent =
    provider === "anthropic"
      ? Boolean(process.env.ANTHROPIC_API_KEY?.trim())
      : provider === "openai"
        ? Boolean(process.env.OPENAI_API_KEY?.trim())
        : Boolean(process.env.GOOGLE_API_KEY?.trim());

  if (!keyPresent) return null;

  const pageList = pages
    .map((p) => `- ${p.url} | ${p.title} | ${p.description ?? ""}`)
    .join("\n");

  const prompt = `You are producing the section structure for an llms.txt file (https://llmstxt.org/) — a Markdown document that lets AI assistants quickly understand a website. Each section name you choose becomes an H2 heading in that document, followed by a list of linked pages. AI assistants use the headings to decide which pages are relevant before reading further.

Group the pages below into 2–6 meaningful sections.

Rules:
- COMPLETENESS: Every URL must appear in EXACTLY one section. Do not drop or duplicate any URL.
- OVERVIEW FIRST: If a homepage or root URL (e.g. "/", "/home") is present, place it in a section named "Overview" and list that section first.
- GROUPING: Cluster conceptually related pages — e.g. "Documentation", "Blog", "Products", "Pricing", "Company", "Help & Support", "API Reference".
- LOCALIZATION: If there are pages for multiple languages or locales, collect them all in a section named "Localized Pages".
- OPTIONAL SECTION: The llms.txt spec reserves the name "Optional" for low-value secondary pages (legal, redirects, boilerplate, login/logout). AI readers may skip this section when context is limited. Use it — but only for genuinely low-priority pages.
- ORDERING: Overview → core content sections → secondary sections → "Optional" (always last).
- HEADINGS: Section names must be concise (2–4 words) and read naturally as Markdown H2 headings.
- BREADTH: Prefer fewer, broader sections over many narrow ones.

Pages (url | title | description):
${pageList}`;

  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      let raw: Record<string, unknown> | null = null;

      if (provider === "anthropic") {
        raw = await callAnthropicGroup(prompt);
      } else if (provider === "openai") {
        raw = await callOpenAIGroup(prompt);
      } else {
        raw = await callGeminiGroup(prompt);
      }

      if (!raw) continue;

      const parsed = SectionsSchema.safeParse(raw);
      if (parsed.success) return parsed.data.sections;
    } catch {
      // retry once
    }
  }

  return null;
}

// ── Anthropic ─────────────────────────────────────────────────────────────────

async function callAnthropicGroup(
  prompt: string,
): Promise<Record<string, unknown> | null> {
  const { default: Anthropic } = await import("@anthropic-ai/sdk");
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  const response = await client.messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 2048,
    tools: [
      {
        name: "group_pages",
        description: "Group crawled pages into named sections for an llms.txt file.",
        input_schema: {
          type: "object" as const,
          properties: {
            sections: {
              type: "array",
              description: "The grouped sections, covering every URL exactly once.",
              items: {
                type: "object",
                properties: {
                  heading: {
                    type: "string",
                    description: "Section heading (2–4 words, e.g. 'Help & Support')",
                  },
                  urls: {
                    type: "array",
                    items: { type: "string" },
                    description: "All URLs belonging to this section.",
                  },
                },
                required: ["heading", "urls"],
              },
            },
          },
          required: ["sections"],
        },
      },
    ],
    tool_choice: { type: "tool" as const, name: "group_pages" },
    messages: [{ role: "user", content: prompt }],
  });

  const block = response.content.find((b) => b.type === "tool_use");
  if (!block || block.type !== "tool_use") return null;
  return block.input as Record<string, unknown>;
}

// ── OpenAI ────────────────────────────────────────────────────────────────────

async function callOpenAIGroup(
  prompt: string,
): Promise<Record<string, unknown> | null> {
  const { default: OpenAI } = await import("openai");
  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

  const response = await client.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [{ role: "user", content: prompt }],
    tools: [
      {
        type: "function" as const,
        function: {
          name: "group_pages",
          description: "Group crawled pages into named sections for an llms.txt file.",
          parameters: {
            type: "object",
            properties: {
              sections: {
                type: "array",
                description: "The grouped sections, covering every URL exactly once.",
                items: {
                  type: "object",
                  properties: {
                    heading: {
                      type: "string",
                      description: "Section heading (2–4 words, e.g. 'Help & Support')",
                    },
                    urls: {
                      type: "array",
                      items: { type: "string" },
                      description: "All URLs belonging to this section.",
                    },
                  },
                  required: ["heading", "urls"],
                },
              },
            },
            required: ["sections"],
          },
        },
      },
    ],
    tool_choice: { type: "function" as const, function: { name: "group_pages" } },
  });

  const toolCall = response.choices[0]?.message?.tool_calls?.[0];
  if (!toolCall || toolCall.type !== "function") return null;

  try {
    return JSON.parse(toolCall.function.arguments) as Record<string, unknown>;
  } catch {
    return null;
  }
}

// ── Gemini ────────────────────────────────────────────────────────────────────

async function callGeminiGroup(
  prompt: string,
): Promise<Record<string, unknown> | null> {
  // Gemini's SDK rejects nested array-of-objects in function declarations, so we
  // accept the output as a JSON string (`sections_json`) and parse it ourselves.
  // The prompt and tool semantics are identical to Anthropic/OpenAI.
  const { GoogleGenerativeAI, FunctionCallingMode } = await import(
    "@google/generative-ai"
  );

  const genAI = new GoogleGenerativeAI(process.env.GOOGLE_API_KEY!);
  const model = genAI.getGenerativeModel({
    model: "gemini-2.0-flash",
    tools: [
      {
        functionDeclarations: [
          {
            name: "group_pages",
            description:
              "Group crawled pages into named sections for an llms.txt file.",
            parameters: {
              type: "object" as never,
              properties: {
                sections_json: {
                  type: "string" as never,
                  description:
                    'JSON array: [{"heading":"...","urls":["..."]},...]. Every URL must appear once.',
                },
              },
              required: ["sections_json"],
            },
          },
        ],
      },
    ],
    toolConfig: {
      functionCallingConfig: {
        mode: FunctionCallingMode.ANY,
        allowedFunctionNames: ["group_pages"],
      },
    },
  });

  const result = await model.generateContent(prompt);
  const call = result.response.functionCalls()?.[0];
  if (!call) return null;

  const args = call.args as Record<string, unknown>;
  const sectionsJson = args["sections_json"];
  if (typeof sectionsJson !== "string") return null;

  try {
    const sections = JSON.parse(sectionsJson);
    return { sections };
  } catch {
    return null;
  }
}
