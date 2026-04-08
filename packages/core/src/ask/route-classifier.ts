import type { WikiJson, PageMeta } from "../types/generation.js";

export type AskRoute = "page-first" | "page-plus-retrieval" | "research";

export type RouteContext = {
  question: string;
  currentPageSlug?: string;
  pageMeta?: PageMeta | null;
  wiki?: WikiJson | null;
};

/**
 * Determines the retrieval route for a question.
 * - page-first: question can be answered from the current page alone
 * - page-plus-retrieval: needs current page + some repo exploration
 * - research: broad question needing deep multi-file investigation
 */
export function classifyRoute(ctx: RouteContext): AskRoute {
  const q = ctx.question.toLowerCase();

  // Research signals: broad, comparative, or exploratory questions
  const researchPatterns = [
    /how does .+ compare/,
    /what is the overall/,
    /explain the architecture/,
    /trace .+ through/,
    /what are all the/,
    /list every/,
    /deep dive/,
    /investigate/,
    /research/,
  ];

  if (researchPatterns.some((p) => p.test(q))) {
    return "research";
  }

  // If user is on a page and question seems page-specific
  if (ctx.currentPageSlug && ctx.pageMeta) {
    const pageSpecific = [
      /this page/,
      /this section/,
      /above/,
      /below/,
      /here/,
      /what does .+ mean/,
      /explain .+ in this/,
    ];

    if (pageSpecific.some((p) => p.test(q))) {
      return "page-first";
    }

    // Check if question mentions files covered by current page
    const mentionsCoveredFile = ctx.pageMeta.coveredFiles.some((f) =>
      q.includes(f.toLowerCase()) || q.includes(f.split("/").pop()?.toLowerCase() ?? ""),
    );

    if (mentionsCoveredFile) {
      return "page-plus-retrieval";
    }
  }

  // Default: page-plus-retrieval if on a page, research if not
  return ctx.currentPageSlug ? "page-plus-retrieval" : "research";
}
