import { defaultSchema } from "rehype-sanitize";

/**
 * Hardened HTML sanitization schema. `rehypeRaw` parses raw HTML embedded
 * in markdown (we want this so tables, details tags, syntax-highlighted
 * code-block class names etc. render correctly), but without sanitization
 * a malicious repo markdown or LLM echo could inject `<img onerror=...>`
 * or `javascript:` links that execute script when the reader opens the
 * page in the local web UI. `rehypeSanitize` with the default schema
 * drops every event handler and restricts href/src to safe protocols.
 *
 * We extend the default schema's `protocols.href` with `cite` so our
 * internal `cite://` citation scheme continues to work. Mermaid diagrams
 * are rendered client-side from plain text code blocks, so they don't
 * need any HTML extensions here.
 *
 * Exported so the vitest regression suite can assert that this schema
 * strips script tags, event handlers, and unsafe URL schemes end-to-end
 * through the unified pipeline the markdown-renderer wires up.
 */
export const sanitizeSchema: typeof defaultSchema = {
  ...defaultSchema,
  protocols: {
    ...(defaultSchema.protocols ?? {}),
    href: [
      ...(defaultSchema.protocols?.href ?? []),
      "cite",
    ],
  },
};

export const SAFE_URL_SCHEMES = new Set(["http", "https", "mailto", "cite", ""]);

/**
 * Keep rehype-sanitize's href filter as the authoritative defense, but
 * also normalize what we hand to link/image rendering so obviously unsafe
 * schemes never reach the DOM even through non-markdown code paths. Empty
 * string handles relative links ("./foo.md").
 */
export function safeUrlTransform(url: string): string {
  // Strip bidi / control chars that some browsers still render in link text.
  // The range is intentional (ASCII controls + BOM + LRO/RLO + isolate marks).
  // eslint-disable-next-line no-control-regex
  const trimmed = url.trim().replace(/[\u0000-\u001F\u007F\u202E\u2066-\u2069]/g, "");
  const schemeMatch = /^([a-z][a-z0-9+.-]*):/i.exec(trimmed);
  const scheme = schemeMatch ? schemeMatch[1].toLowerCase() : "";
  if (!SAFE_URL_SCHEMES.has(scheme)) return "";
  return trimmed;
}
