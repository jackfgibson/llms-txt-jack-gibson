import { eq } from "drizzle-orm";
import { inngest } from "../client";
import { insightsRequested, insightsCompleted } from "../events";
import { db, schema } from "@/lib/db";

const STRUCTURE_BOOST: Record<string, number> = { Excellent: 0.8, Great: 0.4, Good: 0.0 };

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
            if (!pairs) return;
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

      return db
        .select()
        .from(schema.modelQuestions)
        .where(eq(schema.modelQuestions.crawlId, crawlId));
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

          return { provider, result };
        }),
      );

      return results;
    });

    // ── Step 5: grade all 12 answers (3 models × 4 answers) ─────────────────
    const gradedResults = await step.run("grade-answers", async () => {
      const { gradeAnswer } = await import("@/lib/llm/grade-answer");

      const providers = ["anthropic", "openai", "gemini"] as const;

      const graded = await Promise.all(
        evalResults.map(async ({ provider, result }) => {
          if (!result) return { provider, scoredAnswers: [], structurePick: "" };

          const questionSets = providers
            .filter((p) => p !== provider)
            .flatMap((p) =>
              (
                questionRows.find((q) => q.provider === p)!.questions as Array<{
                  question: string;
                  correctAnswer: string;
                }>
              ).map((q) => ({ ...q, sourceProvider: p })),
            );

          const scoredAnswers = await Promise.all(
            result.answers.map(async (a, i) => {
              const qInfo = questionSets[i];
              const gradeResult = await gradeAnswer({
                question: a.question,
                correctAnswer: qInfo?.correctAnswer ?? "",
                givenAnswer: a.answer,
              });
              return {
                question: a.question,
                correctAnswer: qInfo?.correctAnswer ?? "",
                givenAnswer: a.answer,
                score: gradeResult?.score ?? 0,
                reasoning: gradeResult?.reasoning ?? "grading failed",
              };
            }),
          );

          return { provider, scoredAnswers, structurePick: result.structurePick };
        }),
      );

      return graded;
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
        (a, b) => votes[b] - votes[a] || accuracyMap[b] - accuracyMap[a],
      );
      const placements = ["Excellent", "Great", "Good"] as const;
      const placementMap = Object.fromEntries(ranked.map((p, i) => [p, placements[i]]));

      const finalScores = providers.map((p) => ({
        provider: p,
        accuracy: accuracyMap[p],
        structurePlacement: placementMap[p],
        finalScore: round1dp(accuracyMap[p] + STRUCTURE_BOOST[placementMap[p]]),
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
