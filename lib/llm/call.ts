/**
 * Provider-agnostic LLM tool-call helper.
 *
 * When `provider` is explicit, only that provider is attempted (returns null
 * if its key is missing). When omitted, Anthropic → OpenAI → Gemini.
 */

export type LlmProvider = "anthropic" | "openai" | "gemini";

export interface ToolSchema {
  name: string;
  description: string;
  properties: Record<string, { type: string; description: string }>;
  required: string[];
}

export async function callWithTool(
  prompt: string,
  tool: ToolSchema,
  provider?: LlmProvider,
  maxTokens = 512,
): Promise<Record<string, unknown> | null> {
  if (provider === "anthropic") {
    return process.env.ANTHROPIC_API_KEY?.trim()
      ? callAnthropic(prompt, tool, maxTokens)
      : null;
  }
  if (provider === "openai") {
    return process.env.OPENAI_API_KEY?.trim()
      ? callOpenAI(prompt, tool, maxTokens)
      : null;
  }
  if (provider === "gemini") {
    return process.env.GOOGLE_API_KEY?.trim()
      ? callGemini(prompt, tool)
      : null;
  }
  // Auto-select: Anthropic → OpenAI → Gemini
  if (process.env.ANTHROPIC_API_KEY?.trim()) return callAnthropic(prompt, tool, maxTokens);
  if (process.env.OPENAI_API_KEY?.trim()) return callOpenAI(prompt, tool, maxTokens);
  if (process.env.GOOGLE_API_KEY?.trim()) return callGemini(prompt, tool);
  return null;
}

// ── Anthropic ──────────────────────────────────────────────────────────────

async function callAnthropic(
  prompt: string,
  tool: ToolSchema,
  maxTokens = 512,
): Promise<Record<string, unknown> | null> {
  const { default: Anthropic } = await import("@anthropic-ai/sdk");
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  const response = await client.messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: maxTokens,
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
  maxTokens = 512,
): Promise<Record<string, unknown> | null> {
  const { default: OpenAI } = await import("openai");
  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

  const response = await client.chat.completions.create({
    model: "gpt-4o-mini",
    max_tokens: maxTokens,
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

// ── Gemini ─────────────────────────────────────────────────────────────────

async function callGemini(
  prompt: string,
  tool: ToolSchema,
): Promise<Record<string, unknown> | null> {
  const { GoogleGenerativeAI, SchemaType, FunctionCallingMode } =
    await import("@google/generative-ai");

  const genAI = new GoogleGenerativeAI(process.env.GOOGLE_API_KEY!);
  const model = genAI.getGenerativeModel({
    model: "gemini-2.0-flash",
    tools: [
      {
        functionDeclarations: [
          {
            name: tool.name,
            description: tool.description,
            parameters: {
              type: SchemaType.OBJECT,
              properties: Object.fromEntries(
                Object.entries(tool.properties).map(([k, v]) => [
                  k,
                  { type: SchemaType.STRING, description: v.description },
                ]),
              ),
              required: tool.required,
            },
          },
        ],
      },
    ],
    toolConfig: {
      functionCallingConfig: {
        mode: FunctionCallingMode.ANY,
        allowedFunctionNames: [tool.name],
      },
    },
  });

  const result = await model.generateContent(prompt);
  const call = result.response.functionCalls()?.[0];
  if (!call) return null;
  return call.args as Record<string, unknown>;
}
