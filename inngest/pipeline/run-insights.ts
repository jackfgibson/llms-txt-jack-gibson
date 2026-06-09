import { eq } from "drizzle-orm";
import { inngest } from "../client";
import { insightsRequested, insightsCompleted } from "../events";
import { db, schema } from "@/lib/db";

const STRUCTURE_BOOST: Record<string, number> = { Excellent: 0.8, Great: 0.4, Good: 0.0 };
// Cheapest-model-wins tiebreaker: used only when votes AND accuracy are exactly equal
const PROVIDER_PRIORITY: Record<string, number> = { openai: 0, gemini: 1, anthropic: 2 };

function round1dp(n: number) {
  return Math.round(n * 10) / 10;
}

export const runInsights = inngest.createFunction(
  {
    id: "run-insights",
    triggers: [{ event: insightsRequested }],
    retries: 2,
    onFailure: async ({ event }) => {
      const { insightId } = event.data.event.data as { insightId: string };
      await db
        .update(schema.insights)
        .set({ status: "failed" })
        .where(eq(schema.insights.id, insightId));
    },
  },
  async ({ event, step }) => {
    const { insightId, siteId, crawlId } = event.data;

    // ── Step 1: mark running ──────────────────────────────────────────────────
    await step.run("mark-running", async () => {
      await db
        .update(schema.insights)
        .set({ status: "running" })
        .where(eq(schema.insights.id, insightId));
    });

    // ── Step 2: load data ─────────────────────────────────────────────────────
    const { generationRows } = await step.run("load-data", async () => {
      const generationRows = await db
        .select()
        .from(schema.generations)
        .where(eq(schema.generations.crawlId, crawlId));

      const providers = ["anthropic", "openai", "gemini"] as const;
      for (const p of providers) {
        if (!generationRows.some((r) => r.provider === p)) {
          throw new Error(`Missing generation for provider: ${p}`);
        }
      }

      return { generationRows };
    });

    // ── Step 3: ensure Q&A pairs exist (generate on-the-fly for old crawls) ──
    const questionRows = await step.run("ensure-questions", async () => {
      const { generateQuestionsForModel } = await import("@/lib/llm/generate-questions");

      const providers = ["anthropic", "openai", "gemini"] as const;
      const existing = await db
        .select()
        .from(schema.modelQuestions)
        .where(eq(schema.modelQuestions.crawlId, crawlId));

      const missing = providers.filter((p) => !existing.some((q) => q.provider === p));

      if (missing.length > 0) {
        await Promise.all(
          missing.map(async (provider) => {
            const gen = generationRows.find((g) => g.provider === provider)!;
            const pairs = await generateQuestionsForModel(gen.content, provider);
            if (!pairs) throw new Error(`Failed to generate questions for provider: ${provider}`);
            await db
              .insert(schema.modelQuestions)
              .values({
                siteId,
                crawlId,
                generationId: gen.id,
                provider,
                questions: pairs,
              })
              .onConflictDoNothing();
          }),
        );
      }

      const rows = await db
        .select()
        .from(schema.modelQuestions)
        .where(eq(schema.modelQuestions.crawlId, crawlId));

      for (const p of providers) {
        if (!rows.some((r) => r.provider === p)) {
          throw new Error(`Questions missing for provider after generation attempt: ${p}`);
        }
      }

      return rows;
    });

    // ── Step 4: each model evaluates the other two's questions + ranks structure ─
    const evalResults = await step.run("evaluate-all-models", async () => {
      const { evaluateModel } = await import("@/lib/llm/evaluate-model");

      const providers = ["anthropic", "openai", "gemini"] as const;

      const results = await Promise.all(
        providers.map(async (provider) => {
          const ownContent = generationRows.find((g) => g.provider === provider)!.content;
          const otherProviders = providers.filter((p) => p !== provider);

          const questionSets = otherProviders.map((p) => ({
            provider: p,
            questions: questionRows.find((q) => q.provider === p)!.questions as Array<{
              question: string;
              correctAnswer: string;
            }>,
          }));

          const otherContents = otherProviders.map((p) => ({
            provider: p,
            content: generationRows.find((g) => g.provider === p)!.content,
          }));

          const result = await evaluateModel({
            ownContent,
            questionSets,
            otherContents,
            evaluatingProvider: provider,
          });

          if (!result) throw new Error(`evaluateModel returned null for provider: ${provider}`);

          return { provider, result };
        }),
      );

      return results;
    });

    // ── Step 5: grade all answers in a single batch call ────────────────────
    const gradedResults = await step.run("grade-answers", async () => {
      const { gradeAllAnswers } = await import("@/lib/llm/grade-answer");

      const providers = ["anthropic", "openai", "gemini"] as const;

      // Flatten all Q&A items in stable order (per provider, then per answer)
      const flatItems: Array<{
        provider: string;
        question: string;
        correctAnswer: string;
        givenAnswer: string;
      }> = [];

      for (const { provider, result } of evalResults) {
        const correctAnswers = providers
          .filter((p) => p !== provider)
          .flatMap((p) =>
            (
              questionRows.find((q) => q.provider === p)!.questions as Array<{
                question: string;
                correctAnswer: string;
              }>
            ).map((q) => q.correctAnswer),
          );

        result.answers.forEach((a, i) => {
          flatItems.push({
            provider,
            question: a.question,
            correctAnswer: correctAnswers[i] ?? "",
            givenAnswer: a.answer,
          });
        });
      }

      const grades = await gradeAllAnswers(
        flatItems.map(({ question, correctAnswer, givenAnswer }) => ({
          question,
          correctAnswer,
          givenAnswer,
        })),
      );

      return evalResults.map(({ provider, result }) => {
        const scoredAnswers = flatItems
          .map((item, globalIdx) => ({ item, globalIdx }))
          .filter(({ item }) => item.provider === provider)
          .map(({ item, globalIdx }) => ({
            question: item.question,
            correctAnswer: item.correctAnswer,
            givenAnswer: item.givenAnswer,
            score: grades[globalIdx]?.score ?? 0,
            reasoning: grades[globalIdx]?.reasoning ?? "grading failed",
          }));

        return { provider, scoredAnswers, structurePick: result.structurePick };
      });
    });

    // ── Step 6: compute final scores and persist ──────────────────────────────
    const winner = await step.run("compute-and-persist", async () => {
      const providers = ["anthropic", "openai", "gemini"] as const;

      const accuracyMap: Record<string, number> = {};
      for (const { provider, scoredAnswers } of gradedResults) {
        accuracyMap[provider] = round1dp(
          scoredAnswers.reduce((sum, a) => sum + a.score, 0),
        );
      }

      // Tally structure votes
      const votes: Record<string, number> = { anthropic: 0, openai: 0, gemini: 0 };
      for (const { structurePick } of gradedResults) {
        if (structurePick && votes[structurePick] != null) {
          votes[structurePick]++;
        }
      }

      // Rank by votes, tie-break by accuracy
      const ranked = [...providers].sort(
        (a, b) =>
          votes[b] - votes[a] ||
          accuracyMap[b] - accuracyMap[a] ||
          (PROVIDER_PRIORITY[a] ?? 3) - (PROVIDER_PRIORITY[b] ?? 3),
      );
      const placements = ["Excellent", "Great", "Good"] as const;
      const placementMap = Object.fromEntries(ranked.map((p, i) => [p, placements[i]]));

      const finalScores = providers.map((p) => ({
        provider: p,
        accuracy: accuracyMap[p],
        structurePlacement: placementMap[p],
        finalScore: Math.min(10.0, round1dp(accuracyMap[p] + STRUCTURE_BOOST[placementMap[p]])),
      }));

      const topProvider = finalScores.sort((a, b) => b.finalScore - a.finalScore)[0].provider;

      // Insert eval results (idempotent via unique index)
      await db
        .insert(schema.modelEvalResults)
        .values(
          finalScores.map((fs) => {
            const graded = gradedResults.find((g) => g.provider === fs.provider)!;
            return {
              insightId,
              provider: fs.provider,
              accuracy: fs.accuracy,
              structurePlacement: fs.structurePlacement,
              finalScore: fs.finalScore,
              details: {
                questionsAnswered: graded.scoredAnswers,
                structurePick: graded.structurePick,
              },
            };
          }),
        )
        .onConflictDoNothing();

      await db
        .update(schema.insights)
        .set({ status: "completed", winner: topProvider, finishedAt: new Date() })
        .where(eq(schema.insights.id, insightId));

      return topProvider;
    });

    await step.sendEvent("insights-completed", {
      name: insightsCompleted.name,
      data: { insightId, siteId, winner },
    });

    return { winner };
  },
);
