import type { PageType } from "./classify";

interface ScoreInput {
  pageType: PageType;
  depth: number;
  inlinkCount: number;
  isJsShell: boolean;
  hasTitle: boolean;
  hasDescription: boolean;
  hasMainText: boolean;
  mainTextLength: number;
}

// Pages that are most useful for LLM context.
const TYPE_WEIGHT: Record<PageType, number> = {
  home: 20,
  docs: 18,
  api: 17,
  product: 14,
  about: 10,
  blog: 8,
  pricing: 6,
  legal: 2,
  other: 5,
};

export function scorePage(input: ScoreInput): number {
  if (input.isJsShell) return 0;

  let score = TYPE_WEIGHT[input.pageType] ?? 5;

  // Depth penalty: shallower pages are more likely to be canonical entry points.
  score -= input.depth * 3;

  // Inlink bonus: pages linked-to from many other pages are structurally important.
  score += Math.min(input.inlinkCount * 2, 10);

  // Content richness
  if (input.hasTitle) score += 3;
  if (input.hasDescription) score += 2;
  if (!input.hasMainText) score -= 5;

  // Reward pages with meaningful content length (up to a cap)
  const textBonus = Math.min(Math.floor(input.mainTextLength / 500), 5);
  score += textBonus;

  return Math.max(score, 0);
}
