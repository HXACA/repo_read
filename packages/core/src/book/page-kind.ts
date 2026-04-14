export const PAGE_KINDS = [
  "guide",
  "explanation",
  "reference",
  "appendix",
] as const;

export type PageKind = (typeof PAGE_KINDS)[number];

export function isPageKind(value: unknown): value is PageKind {
  return typeof value === "string" && PAGE_KINDS.includes(value as PageKind);
}
