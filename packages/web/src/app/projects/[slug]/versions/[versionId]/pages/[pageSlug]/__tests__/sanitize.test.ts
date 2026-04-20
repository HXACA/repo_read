import { describe, it, expect } from "vitest";
import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
import remarkRehype from "remark-rehype";
import rehypeRaw from "rehype-raw";
import rehypeSanitize from "rehype-sanitize";
import rehypeStringify from "rehype-stringify";
import { sanitizeSchema, safeUrlTransform } from "../sanitize.js";

// The test runs the same plugin chain the <ReactMarkdown> renderer wires
// up (minus rehypeHighlight, which only annotates code blocks). Output is
// HTML string — we assert the dangerous bits are gone.
async function render(md: string): Promise<string> {
  const file = await unified()
    .use(remarkParse)
    .use(remarkGfm)
    .use(remarkRehype, { allowDangerousHtml: true })
    .use(rehypeRaw)
    .use(rehypeSanitize, sanitizeSchema)
    .use(rehypeStringify)
    .process(md);
  return String(file);
}

describe("sanitize schema", () => {
  it("strips <script> tags and their payload from raw HTML", async () => {
    const out = await render('hello\n\n<script>window.alert("xss")</script>\n\nworld');
    expect(out).not.toContain("<script");
    expect(out).not.toContain("alert");
    expect(out).toContain("hello");
    expect(out).toContain("world");
  });

  it("strips inline event handlers on <img>", async () => {
    const out = await render('<img src="/ok.png" onerror="fetch(\'//evil.test\')">');
    expect(out).not.toContain("onerror");
    expect(out).not.toContain("fetch");
    // image tag itself can stay (src is http-ish or relative)
  });

  it("drops javascript: hrefs from anchor tags", async () => {
    const out = await render('[click me](javascript:alert(1))');
    expect(out).not.toMatch(/href="javascript:/i);
    expect(out).not.toContain("alert");
  });

  it("drops data: hrefs (default schema is strict)", async () => {
    const out = await render('[x](data:text/html,<script>alert(1)</script>)');
    expect(out).not.toMatch(/href="data:/i);
  });

  it("drops javascript: URLs in raw HTML <a>", async () => {
    const out = await render('<a href="javascript:void(0)" onclick="x()">click</a>');
    expect(out).not.toMatch(/href="javascript:/i);
    expect(out).not.toContain("onclick");
  });

  it("preserves safe http/https hrefs", async () => {
    const out = await render('[ok](https://example.com/page)');
    expect(out).toContain('href="https://example.com/page"');
  });

  it("preserves the internal cite:// scheme (whitelisted)", async () => {
    const out = await render('[ref](cite://file/src/foo.ts)');
    expect(out).toContain('href="cite://file/src/foo.ts"');
  });

  it("drops <iframe> entirely", async () => {
    const out = await render('<iframe src="https://evil.test"></iframe>');
    expect(out).not.toContain("<iframe");
    expect(out).not.toContain("evil.test");
  });

  it("strips <style> tags so CSS can't load cross-origin resources", async () => {
    // The <style> tag itself must be dropped. The inner text may remain
    // as plain text nodes — that's fine for security (no CSS engine parses
    // it), just visually noisy. We only assert the active vector is gone.
    const out = await render('<style>body { background: url("https://evil.test/beacon"); }</style>');
    expect(out).not.toMatch(/<style[\s>]/);
    expect(out).not.toMatch(/<\/style>/);
  });

  it("preserves safe HTML structure (tables, code, details)", async () => {
    const md = `
| a | b |
| - | - |
| 1 | 2 |

\`\`\`ts
const x = 1;
\`\`\`

<details><summary>more</summary>hidden</details>
`;
    const out = await render(md);
    expect(out).toContain("<table");
    expect(out).toContain("<code");
    expect(out).toContain("<details");
  });
});

describe("safeUrlTransform", () => {
  it("preserves http, https, mailto, cite schemes", () => {
    expect(safeUrlTransform("https://example.com/page")).toBe("https://example.com/page");
    expect(safeUrlTransform("http://example.com/page")).toBe("http://example.com/page");
    expect(safeUrlTransform("mailto:x@example.com")).toBe("mailto:x@example.com");
    expect(safeUrlTransform("cite://file/src/foo.ts")).toBe("cite://file/src/foo.ts");
  });

  it("preserves relative links (no scheme)", () => {
    expect(safeUrlTransform("./foo.md")).toBe("./foo.md");
    expect(safeUrlTransform("../bar")).toBe("../bar");
    expect(safeUrlTransform("#anchor")).toBe("#anchor");
  });

  it("rejects javascript:, data:, vbscript:, file: schemes", () => {
    expect(safeUrlTransform("javascript:alert(1)")).toBe("");
    expect(safeUrlTransform("data:text/html,foo")).toBe("");
    expect(safeUrlTransform("vbscript:msgbox")).toBe("");
    expect(safeUrlTransform("file:///etc/passwd")).toBe("");
  });

  it("is case-insensitive on the scheme check", () => {
    expect(safeUrlTransform("JavaScript:alert(1)")).toBe("");
    expect(safeUrlTransform("JAVASCRIPT:alert(1)")).toBe("");
    expect(safeUrlTransform("Https://example.com")).toBe("Https://example.com");
  });

  it("strips control chars and bidi overrides from link text", () => {
    // U+202E RIGHT-TO-LEFT OVERRIDE — used in filename-spoofing attacks
    const spoof = "https://example.com/\u202Egpj.exe";
    expect(safeUrlTransform(spoof)).toBe("https://example.com/gpj.exe");
    // Null byte should be removed
    expect(safeUrlTransform("https://example.com/\u0000evil")).toBe("https://example.com/evil");
  });

  it("trims surrounding whitespace before evaluating the scheme", () => {
    expect(safeUrlTransform("   javascript:alert(1)   ")).toBe("");
    expect(safeUrlTransform("  https://ok.test  ")).toBe("https://ok.test");
  });

  it("rejects unknown-but-well-formed schemes", () => {
    expect(safeUrlTransform("unknown:foo")).toBe("");
    expect(safeUrlTransform("telnet://host")).toBe("");
    expect(safeUrlTransform("ssh://host")).toBe("");
  });

  it("treats malformed URLs with no valid scheme as relative (harmless)", () => {
    // Input like `::::://evil` has no `[a-z]`-leading scheme, so the regex
    // yields scheme="" and safeUrlTransform passes it through as-if
    // relative. Browsers resolving href="::::://evil" append it to the
    // current origin — not an exfiltration vector, just a dead link.
    expect(safeUrlTransform("::::://evil")).toBe("::::://evil");
  });
});
