import { z } from "zod";

export interface EvalPage {
  url: string;
  title: string | null;
  mainText: string | null;
}

export interface QAPair {
  question: string;
  answer: string; // ground-truth from corpus
}

export interface EvalResult {
  question: string;
  groundTruth: string;
  coldAnswer: string;
  coldCorrect: boolean;
  withContextAnswer: string;
  withContextCorrect: boolean;
}

export interface EvalReport {
  pairs: EvalResult[];
  coldScore: number;
  withContextScore: number;
  lift: number; // withContextScore - coldScore
}

const QAListSchema = z.object({
  pairs: z.array(z.object({
    question: z.string(),
    answer: z.string(),
  })).min(1).max(10),
});

const GradeSchema = z.object({
  correct: z.boolean(),
  explanation: z.string(),
});

function buildCorpusContext(pages: EvalPage[]): string {
  return pages
    .slice(0, 10)
    .map((p) => `URL: ${p.url}\nTitle: ${p.title ?? "(none)"}\n${(p.mainText ?? "").slice(0, 800)}`)
    .join("\n\n---\n\n");
}

async function callClaude(systemPrompt: string, userMessage: string): Promise<string> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY is required for eval");

  const Anthropic = (await import("@anthropic-ai/sdk")).default;
  const client = new Anthropic({ apiKey });

  const msg = await client.messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 1024,
    system: systemPrompt,
    messages: [{ role: "user", content: userMessage }],
  });

  const block = msg.content[0];
  return block.type === "text" ? block.text : "";
}

/** Generate 6–10 factual Q&A pairs from crawled pages. */
export async function generateQAPairs(pages: EvalPage[]): Promise<QAPair[]> {
  const corpus = buildCorpusContext(pages);

  const system = `You are a factual question generator. Given web page content, produce factual questions whose answers are explicitly present in the content. Output valid JSON only.`;

  const prompt = `Generate 6 to 8 factual questions about this website, each with a short (1–2 sentence) answer grounded in the content below.

Output format (JSON only, no prose):
{"pairs": [{"question": "...", "answer": "..."}, ...]}

Content:
${corpus}`;

  const raw = await callClaude(system, prompt);

  // extract JSON from the response
  const jsonMatch = raw.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error("No JSON in Q&A response");

  const parsed = QAListSchema.parse(JSON.parse(jsonMatch[0]));
  return parsed.pairs;
}

/** Ask a question without any context. */
async function askCold(question: string): Promise<string> {
  return callClaude(
    "You are a helpful assistant. Answer the question as best you can. Be concise.",
    question,
  );
}

/** Ask a question with the generated llms.txt as context. */
async function askWithContext(question: string, llmsTxt: string): Promise<string> {
  return callClaude(
    `You are a helpful assistant. Use the following llms.txt document as your primary source to answer the question. Be concise.\n\n<llms.txt>\n${llmsTxt}\n</llms.txt>`,
    question,
  );
}

/** Grade an answer as correct/incorrect vs. the ground truth. */
async function gradeAnswer(question: string, groundTruth: string, answer: string): Promise<boolean> {
  const raw = await callClaude(
    `You are an answer grader. Given a question, a ground-truth answer, and a candidate answer, decide if the candidate answer is factually correct according to the ground truth. Output JSON only.`,
    `Question: ${question}
Ground truth: ${groundTruth}
Candidate answer: ${answer}

Output format (JSON only): {"correct": true/false, "explanation": "one sentence"}`,
  );

  const jsonMatch = raw.match(/\{[\s\S]*\}/);
  if (!jsonMatch) return false;
  try {
    const parsed = GradeSchema.parse(JSON.parse(jsonMatch[0]));
    return parsed.correct;
  } catch {
    return false;
  }
}

/**
 * Run the full eval loop:
 * 1. Generate Q&A pairs from the corpus
 * 2. For each pair, ask cold and ask with llms.txt context
 * 3. Grade both answers
 * 4. Return the report
 *
 * Concurrency is capped at 2 questions at a time (each question makes up to 4 Claude
 * calls) to stay within Anthropic's concurrent-connection rate limit.
 */
export async function runEval(pages: EvalPage[], llmsTxt: string): Promise<EvalReport> {
  const pairs = await generateQAPairs(pages);

  const pLimit = (await import("p-limit")).default;
  const limit = pLimit(2);

  const results: EvalResult[] = await Promise.all(
    pairs.map((pair) =>
      limit(async () => {
        // cold + context in parallel (2 connections)
        const [coldAnswer, withContextAnswer] = await Promise.all([
          askCold(pair.question),
          askWithContext(pair.question, llmsTxt),
        ]);

        // grade in parallel (2 connections, after the answers are ready)
        const [coldCorrect, withContextCorrect] = await Promise.all([
          gradeAnswer(pair.question, pair.answer, coldAnswer),
          gradeAnswer(pair.question, pair.answer, withContextAnswer),
        ]);

        return {
          question: pair.question,
          groundTruth: pair.answer,
          coldAnswer,
          coldCorrect,
          withContextAnswer,
          withContextCorrect,
        };
      }),
    ),
  );

  const total = results.length;
  const coldScore = total > 0 ? Math.round((results.filter((r) => r.coldCorrect).length / total) * 100) : 0;
  const withContextScore = total > 0 ? Math.round((results.filter((r) => r.withContextCorrect).length / total) * 100) : 0;

  return {
    pairs: results,
    coldScore,
    withContextScore,
    lift: withContextScore - coldScore,
  };
}
