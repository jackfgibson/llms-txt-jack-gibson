/**
 * Returns true if any supported LLM key is configured.
 * Provider priority (first key wins): Anthropic → OpenAI.
 */
export function hasApiKey(): boolean {
  return (
    Boolean(process.env.ANTHROPIC_API_KEY?.trim()) ||
    Boolean(process.env.OPENAI_API_KEY?.trim())
  );
}
