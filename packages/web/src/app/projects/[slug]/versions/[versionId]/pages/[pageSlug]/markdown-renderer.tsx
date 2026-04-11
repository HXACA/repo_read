"use client";

import React from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeRaw from "rehype-raw";
import rehypeHighlight from "rehype-highlight";
import { MermaidBlock } from "./mermaid-block";
import { CitationPopover } from "./citation-popover";

/** Convert heading text → URL-safe slug for anchor IDs (TOC) */
function slugify(text: string): string {
  return text
    .toLowerCase()
    .trim()
    .replace(/[^\w\s\u4e00-\u9fff-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

/**
 * Stateful heading-id generator matching {@link toc.tsx}. On collision,
 * appends -2, -3, ... in document order. A fresh instance must be created
 * per render pass so counts start at zero for each new document.
 */
function makeHeadingIdFactory(): (text: string) => string {
  const counts = new Map<string, number>();
  return (text: string) => {
    const base = slugify(text) || "section";
    const n = (counts.get(base) ?? 0) + 1;
    counts.set(base, n);
    return n === 1 ? base : `${base}-${n}`;
  };
}

/**
 * Strip LLM "thinking" preamble and trailing metadata JSON
 * that the generation pipeline leaves in page markdown.
 *
 * Patterns handled:
 *   1. "Now I have enough info..." + ```markdown wrapper
 *   2. "Now I have..." + bare # heading (no fence)
 *   3. Clean content starting with # heading (no-op)
 *   4. Trailing ```json { "summary": ... } block (often truncated)
 */
function cleanContent(raw: string): string {
  let text = raw;

  // Find the first top-level heading (# or ##)
  const headingIdx = text.search(/^#{1,2}\s/m);

  if (headingIdx > 0) {
    text = text.slice(headingIdx);
  } else if (headingIdx === -1) {
    // No heading found — return as-is (shouldn't happen for wiki pages)
    return text.trim();
  }

  // Strip trailing metadata JSON block (often truncated from pipeline)
  const lastJsonFence = text.lastIndexOf("\n```json\n");
  if (lastJsonFence !== -1) {
    const tail = text.slice(lastJsonFence);
    if (/"summary"|"citations"/.test(tail)) {
      text = text.slice(0, lastJsonFence);
    }
  }

  // Strip a trailing lone ``` that was the markdown fence close
  if (text.trimEnd().endsWith("\n```")) {
    const idx = text.lastIndexOf("\n```");
    const afterFence = text.slice(idx + 4).trim();
    if (afterFence === "") {
      text = text.slice(0, idx);
    }
  }

  return text.trim();
}

/**
 * Convert [cite:kind:target:locator] into markdown link syntax that
 * react-markdown can natively render (more reliable than raw HTML tags).
 *
 *   Format: [display](cite://kind/?t=target&l=locator)
 *
 * The `a` component handler detects `cite://` URLs and renders a popover.
 * Skips matches inside fenced code blocks and inline code.
 */
function preprocessCitations(content: string): string {
  // Split on fenced code blocks and inline code so we can skip them
  const parts = content.split(/(```[\s\S]*?```|`[^`\n]+`)/g);
  return parts
    .map((part) => {
      if (
        part.startsWith("```") ||
        (part.startsWith("`") && part.endsWith("`") && !part.includes("\n"))
      ) {
        return part; // leave code blocks/inline code untouched
      }
      return part.replace(
        /\[cite:(\w+):([^\]:]+)(?::([^\]]*))?\]/g,
        (_match, kind: string, target: string, locator?: string) => {
          const display = locator ? `${target}:${locator}` : target;
          const params = new URLSearchParams({ t: target });
          if (locator) params.set("l", locator);
          // Escape display chars that would break markdown link syntax
          const safeDisplay = display.replace(/[[\]]/g, "");
          return `[${safeDisplay}](cite://${kind}/?${params.toString()})`;
        },
      );
    })
    .join("");
}

/** Parse a citation URL produced by preprocessCitations */
function parseCiteUrl(href: string | undefined): {
  kind: string;
  target: string;
  locator: string;
} | null {
  if (!href || !href.startsWith("cite://")) return null;
  try {
    // cite://kind/?t=...&l=...
    const after = href.slice("cite://".length);
    const slashIdx = after.indexOf("/");
    const kind = slashIdx >= 0 ? after.slice(0, slashIdx) : after;
    const queryStart = after.indexOf("?");
    const query = queryStart >= 0 ? after.slice(queryStart + 1) : "";
    const params = new URLSearchParams(query);
    return {
      kind,
      target: params.get("t") ?? "",
      locator: params.get("l") ?? "",
    };
  } catch {
    return null;
  }
}

/** Recursively extract plain text from React children tree */
function textOf(node: React.ReactNode): string {
  if (typeof node === "string") return node;
  if (typeof node === "number") return String(node);
  if (node == null || typeof node === "boolean") return "";
  if (Array.isArray(node)) return node.map(textOf).join("");
  if (React.isValidElement(node))
    return textOf((node.props as { children?: React.ReactNode }).children);
  return "";
}

export function MarkdownRenderer({
  content,
  slug,
  versionId,
}: {
  content: string;
  slug?: string;
  versionId?: string;
}) {
  const processed = preprocessCitations(cleanContent(content));
  // Fresh id factory per render pass — heading components close over this
  // so collisions in document order get disambiguated with `-2`, `-3`, etc.
  // Must walk h1-h4 in order to stay in sync with toc.tsx.
  const makeHeadingId = makeHeadingIdFactory();

  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      rehypePlugins={[rehypeRaw, [rehypeHighlight, { ignoreMissing: true }]]}
      skipHtml={false}
      // Allow custom URL schemes (cite://) for citation links
      urlTransform={(url) => url}
      components={{
        /* ── Headings with anchor IDs for TOC navigation ── */
        h1({ children, node: _n }) {
          const id = makeHeadingId(textOf(children));
          return <h1 id={id} suppressHydrationWarning>{children}</h1>;
        },
        h2({ children, node: _n }) {
          const id = makeHeadingId(textOf(children));
          return <h2 id={id} suppressHydrationWarning>{children}</h2>;
        },
        h3({ children, node: _n }) {
          const id = makeHeadingId(textOf(children));
          return <h3 id={id} suppressHydrationWarning>{children}</h3>;
        },
        h4({ children, node: _n }) {
          const id = makeHeadingId(textOf(children));
          return <h4 id={id} suppressHydrationWarning>{children}</h4>;
        },

        /* ── Fenced code blocks (pre > code) ── */
        pre({ children, node: _n }) {
          const child = React.Children.toArray(children)[0];

          if (React.isValidElement(child)) {
            const cp = child.props as {
              className?: string;
              children?: React.ReactNode;
            };
            const cls = cp.className || "";

            // Mermaid → delegate to interactive block
            if (cls.includes("language-mermaid")) {
              return (
                <MermaidBlock code={textOf(cp.children).replace(/\n$/, "")} />
              );
            }

            // Extract language label
            const langMatch = /language-(\w+)/.exec(cls);
            const lang = langMatch?.[1];

            return (
              <div className="code-block">
                {lang && <div className="code-block-lang">{lang}</div>}
                <pre className="code-block-pre">{children}</pre>
              </div>
            );
          }

          return <pre className="code-block-pre">{children}</pre>;
        },

        /* ── Code (inline + fenced) ── */
        code({ className, children, node: _n, ...props }) {
          if (!className) {
            // Distinguish inline code from fenced blocks without a language
            const text = String(children);
            if (text.includes("\n")) {
              // Multi-line → fenced code block without language
              return <code {...props}>{children}</code>;
            }
            return (
              <code className="inline-code" {...props}>
                {children}
              </code>
            );
          }
          // Fenced code (inside <pre>) — rehype-highlight already processed
          return (
            <code className={className} {...props}>
              {children}
            </code>
          );
        },

        /* ── Tables ── */
        table({ children, node: _n }) {
          return (
            <div className="table-wrap">
              <table className="rr-table">{children}</table>
            </div>
          );
        },
        thead({ children, node: _n }) {
          return <thead className="rr-thead">{children}</thead>;
        },
        th({ children, node: _n }) {
          return <th className="rr-th">{children}</th>;
        },
        td({ children, node: _n }) {
          return <td className="rr-td">{children}</td>;
        },

        /* ── Links + citations (cite:// scheme) ── */
        a({ href, children, node: _n }) {
          // Detect citation URLs from preprocessCitations
          const cite = parseCiteUrl(href);
          if (cite) {
            // With slug+versionId: render interactive popover
            if (slug && versionId) {
              return (
                <CitationPopover
                  kind={cite.kind}
                  target={cite.target}
                  locator={cite.locator}
                  slug={slug}
                  versionId={versionId}
                >
                  {children}
                </CitationPopover>
              );
            }
            // Fallback: static chip
            const styleClass =
              cite.kind === "page"
                ? "cite-chip-page"
                : cite.kind === "commit"
                  ? "cite-chip-commit"
                  : "cite-chip-file";
            const icon =
              cite.kind === "page"
                ? "\u25A3"
                : cite.kind === "commit"
                  ? "\u2197"
                  : "\u2630";
            return (
              <span className={`cite-chip ${styleClass}`}>
                <span className="cite-icon">{icon}</span>
                {children}
              </span>
            );
          }

          const isExternal = href?.startsWith("http");
          return (
            <a
              href={href}
              className="rr-link"
              {...(isExternal
                ? { target: "_blank", rel: "noopener noreferrer" }
                : {})}
            >
              {children}
              {isExternal && (
                <span className="rr-external-icon">&thinsp;&#8599;</span>
              )}
            </a>
          );
        },

        /* ── Blockquote ── */
        blockquote({ children, node: _n }) {
          return <blockquote className="rr-blockquote">{children}</blockquote>;
        },

        /* ── Horizontal rule ── */
        hr({ node: _n }) {
          return <hr className="rr-hr" />;
        },
      }}
    >
      {processed}
    </ReactMarkdown>
  );
}
