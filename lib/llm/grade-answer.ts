import { callWithTool } from "./call";

export async function gradeAllAnswers(
  items: Array<{ question: string; correctAnswer: string; givenAnswer: string }>,
): Promise<Array<{ score: number; reasoning: string }>> {
  const questionsBlock = items
    .map(
      (item, i) =>
        `Item ${i + 1}:\nQuestion: ${item.question}\nCorrect Answer: ${item.correctAnswer}\nGiven Answer: ${item.givenAnswer}`,
    )
    .join("\n\n");

  const properties: Record<string, { type: string; description: string }> = {};
  const required: string[] = [];
  for (let i = 1; i <= items.length; i++) {
    properties[`score_${i}`] = { type: "number", description: `Score for item ${i}: 0.0–2.5 in 0.5 increments` };
    properties[`reasoning_${i}`] = { type: "string", description: `One-sentence reasoning for item ${i}` };
    required.push(`score_${i}`, `reasoning_${i}`);
  }

  const result = await callWithTool(
    `Grade each of the following ${items.length} answers to factual questions about llms.txt files.\n\nScore 0.0–2.5:\n- 2.5: Completely correct\n- 1.5–2.0: Mostly correct, minor gaps\n- 0.5–1.0: Partially correct\n- 0.0: Incorrect or irrelevant\n\n${questionsBlock}`,
    {
      name: "grade_all_answers",
      description: `Grade all ${items.length} answers, returning a score and one-sentence reasoning for each`,
      properties,
      required,
    },
    "openai",
    1024,
  );

  return items.map((_, i) => {
    const raw = result?.[`score_${i + 1}`] as number | undefined;
    const reasoning = result?.[`reasoning_${i + 1}`] as string | undefined;
    if (raw == null || !reasoning) return { score: 0, reasoning: "grading failed" };
    return {
      score: Math.max(0, Math.min(2.5, Math.round(raw * 10) / 10)),
      reasoning,
    };
  });
}
