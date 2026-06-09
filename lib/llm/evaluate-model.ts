import { callWithTool, type LlmProvider } from "./call";

export async function evaluateModel(input: {
  ownContent: string;
  questionSets: Array<{
    provider: string;
    questions: Array<{ question: string; correctAnswer: string }>;
  }>;
  otherContents: Array<{
    provider: string;
    content: string;
  }>;
  evaluatingProvider: LlmProvider;
}): Promise<{
  answers: Array<{ question: string; answer: string }>;
  structurePick: string;
} | null> {
  const { ownContent, questionSets, otherContents, evaluatingProvider } = input;

  // Flatten 4 questions from the other 2 models
  const allQuestions: Array<{ question: string; sourceProvider: string }> = [];
  for (const qs of questionSets) {
    for (const q of qs.questions) {
      allQuestions.push({ question: q.question, sourceProvider: qs.provider });
    }
  }

  const questionsBlock = allQuestions
    .map((q, i) => `Question ${i + 1} (from ${q.sourceProvider}): ${q.question}`)
    .join("\n");

  const structureBlock = otherContents
    .map((o) => `--- ${o.provider} llms.txt ---\n${o.content}`)
    .join("\n\n");

  const prompt = `You are evaluating an llms.txt file.

YOUR llms.txt:
${ownContent}

Answer the following 4 questions using ONLY the content of YOUR llms.txt above:
${questionsBlock}

Additionally, compare the structure quality of these two other models' llms.txt files and pick the better-structured one:
${structureBlock}

Use the tool to submit your 4 answers and your structure pick.`;

  const otherProviders = otherContents.map((o) => o.provider);

  const result = await callWithTool(
    prompt,
    {
      name: "evaluate_and_rank",
      description:
        "Answer 4 questions using your llms.txt content and pick which other model has better structure",
      properties: {
        answer_1: { type: "string", description: "Answer to question 1" },
        answer_2: { type: "string", description: "Answer to question 2" },
        answer_3: { type: "string", description: "Answer to question 3" },
        answer_4: { type: "string", description: "Answer to question 4" },
        structure_winner: {
          type: "string",
          description: `Which of the two other providers has better-structured llms.txt? Must be exactly one of: ${otherProviders.join(", ")}`,
        },
      },
      required: ["answer_1", "answer_2", "answer_3", "answer_4", "structure_winner"],
    },
    evaluatingProvider,
    1024,
  );

  if (!result) return null;

  const answers = [
    result.answer_1 as string | undefined,
    result.answer_2 as string | undefined,
    result.answer_3 as string | undefined,
    result.answer_4 as string | undefined,
  ];

  if (answers.some((a) => !a)) return null;

  const structurePick = result.structure_winner as string | undefined;
  if (!structurePick || !otherProviders.includes(structurePick)) return null;

  return {
    answers: allQuestions.map((q, i) => ({ question: q.question, answer: answers[i]! })),
    structurePick,
  };
}
