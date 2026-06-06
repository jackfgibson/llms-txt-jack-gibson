export type PageType =
  | "home"
  | "docs"
  | "api"
  | "blog"
  | "about"
  | "pricing"
  | "legal"
  | "product"
  | "other";

interface ClassifyInput {
  url: string;
  title: string | null;
  h1: string | null;
  metaDescription: string | null;
  depth: number;
}

const PATH_RULES: Array<[RegExp, PageType]> = [
  [/^\/?$/, "home"],
  [/\/(docs?|documentation|guide|guides|tutorial|reference|learn|manual|wiki)(\/|$)/i, "docs"],
  [/\/(api|api-reference|api-docs|openapi|swagger)(\/|$)/i, "api"],
  [/\/(blog|posts?|articles?|news|updates?|changelog)(\/|$)/i, "blog"],
  [/\/(about|company|team|story|mission|who-we-are)(\/|$)/i, "about"],
  [/\/(pricing|plans?|billing|subscription)(\/|$)/i, "pricing"],
  [/\/(legal|terms|privacy|tos|gdpr|cookie|license)(\/|$)/i, "legal"],
  [/\/(product|features?|solutions?|platform|use-cases?)(\/|$)/i, "product"],
];

const TEXT_HINTS: Array<[RegExp, PageType]> = [
  [/\bAPI reference\b|\bendpoint\b|\bHTTP method\b/i, "api"],
  [/\bhow to\b|\bget started\b|\binstallation\b|\bquickstart\b/i, "docs"],
  [/\bpricing\b|\bper month\b|\bfree tier\b|\benterprise plan\b/i, "pricing"],
  [/\bprivacy policy\b|\bterms of service\b|\bterms and conditions\b/i, "legal"],
  [/\babout us\b|\bour mission\b|\bour team\b/i, "about"],
];

export function classifyPage(input: ClassifyInput): PageType {
  const path = (() => {
    try {
      return new URL(input.url).pathname;
    } catch {
      return "/";
    }
  })();

  if (input.depth === 0) return "home";

  for (const [re, type] of PATH_RULES) {
    if (re.test(path)) return type;
  }

  const text = [input.title, input.h1, input.metaDescription]
    .filter(Boolean)
    .join(" ");
  for (const [re, type] of TEXT_HINTS) {
    if (re.test(text)) return type;
  }

  return "other";
}
