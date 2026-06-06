/**
 * Provider-agnostic LLM tool-call helper.
 *
 * When `provider` is explicit, only that provider is attempted (returns null
 * if its key is missing). When omitted, Anthropic is tried first, then OpenAI.
 */

export interface ToolSchema {
  name: string;
  description: string;
  properties: Record<string, { type: string; description: string }>;
  required: string[];
}

export async function callWithTool(
  prompt: string,
  tool: ToolSchema,
  provider?: "anthropic" | "openai",
): Promise<Record<string, unknown> | null> {
  if (provider === "anthropic") {
    return process.env.ANTHROPIC_API_KEY?.trim()
      ? callAnthropic(prompt, tool)
      : null;
  }
  if (provider === "openai") {
    return process.env.OPENAI_API_KEY?.trim()
      ? callOpenAI(prompt, tool)
      : null;
  }
  // Auto-select: Anthropic → OpenAI
  if (process.env.ANTHROPIC_API_KEY?.trim()) return callAnthropic(prompt, tool);
  if (process.env.OPENAI_API_KEY?.trim()) return callOpenAI(prompt, tool);
  return null;
}

// ── Anthropic ──────────────────────────────────────────────────────────────

async function callAnthropic(
  prompt: string,
  tool: ToolSchema,
): Promise<Record<string, unknown> | null> {
  const { default: Anthropic } = await import("@anthropic-ai/sdk");
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  const response = await client.messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 512,
    tools: [
      {
        name: tool.name,
        description: tool.description,
        input_schema: {
          type: "object" as const,
          properties: tool.properties,
          required: tool.required,
        },
      },
    ],
    tool_choice: { type: "tool" as const, name: tool.name },
    messages: [{ role: "user", content: prompt }],
  });

  const block = response.content.find((b) => b.type === "tool_use");
  if (!block || block.type !== "tool_use") return null;
  return block.input as Record<string, unknown>;
}

// ── OpenAI ─────────────────────────────────────────────────────────────────

async function callOpenAI(
  prompt: string,
  tool: ToolSchema,
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
          name: tool.name,
          description: tool.description,
          parameters: {
            type: "object",
            properties: tool.properties,
            required: tool.required,
          },
        },
      },
    ],
    tool_choice: { type: "function" as const, function: { name: tool.name } },
  });

  const toolCall = response.choices[0]?.message?.tool_calls?.[0];
  if (!toolCall || toolCall.type !== "function") return null;

  try {
    return JSON.parse(toolCall.function.arguments) as Record<string, unknown>;
  } catch {
    return null;
  }
}
