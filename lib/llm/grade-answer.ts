import { callWithTool } from "./call";

export async function gradeAnswer(input: {
  question: string;
  correctAnswer: string;
  givenAnswer: string;
}): Promise<{ score: number; reasoning: string } | null> {
  const { question, correctAnswer, givenAnswer } = input;

  const result = await callWithTool(
    `Grade the following answer to a factual question about an llms.txt file.

Question: ${question}
Correct Answer: ${correctAnswer}
Given Answer: ${givenAnswer}

Score the given answer on a scale of 0.0 to 2.5 (one decimal place):
- 2.5: Completely correct and precise
- 1.5–2.0: Mostly correct with minor gaps
- 0.5–1.0: Partially correct but missing key details
- 0.0: Incorrect or irrelevant`,
    {
      name: "grade_answer",
      description: "Grade a factual answer on a 0.0–2.5 scale",
      properties: {
        score: {
          type: "number",
          description: "Score from 0.0 to 2.5 in 0.5 increments",
        },
        reasoning: {
          type: "string",
          description: "Brief explanation of the score",
        },
      },
      required: ["score", "reasoning"],
    },
  );

  if (!result) return null;

  const raw = result.score as number | undefined;
  const reasoning = result.reasoning as string | undefined;

  if (raw == null || !reasoning) return null;

  // Clamp to valid range
  const score = Math.max(0, Math.min(2.5, Math.round(raw * 10) / 10));

  return { score, reasoning };
}
