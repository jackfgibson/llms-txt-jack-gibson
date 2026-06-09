import { callWithTool, type LlmProvider } from "./call";

export async function generateQuestionsForModel(
  llmstxtContent: string,
  provider: LlmProvider,
): Promise<Array<{ question: string; correctAnswer: string }> | null> {
  const result = await callWithTool(
    `You are evaluating an llms.txt file. Generate 2 distinct, specific factual questions that can be answered directly from the content below. Each answer must be grounded in the text — do not invent facts.\n\n${llmstxtContent}`,
    {
      name: "generate_site_questions",
      description:
        "Generate 2 factual questions with correct answers about this site based on the provided llms.txt content",
      properties: {
        question_1: {
          type: "string",
          description: "First specific factual question answerable from the llms.txt",
        },
        answer_1: {
          type: "string",
          description: "Correct answer grounded in the llms.txt content",
        },
        question_2: {
          type: "string",
          description: "Second specific factual question answerable from the llms.txt",
        },
        answer_2: {
          type: "string",
          description: "Correct answer grounded in the llms.txt content",
        },
      },
      required: ["question_1", "answer_1", "question_2", "answer_2"],
    },
    provider,
  );

  if (!result) return null;

  const q1 = result.question_1 as string | undefined;
  const a1 = result.answer_1 as string | undefined;
  const q2 = result.question_2 as string | undefined;
  const a2 = result.answer_2 as string | undefined;

  if (!q1 || !a1 || !q2 || !a2) return null;

  return [
    { question: q1, correctAnswer: a1 },
    { question: q2, correctAnswer: a2 },
  ];
}
