import * as fs from "node:fs/promises";
import * as path from "node:path";
import { NextResponse } from "next/server";
import { StorageAdapter, loadProjectConfig } from "@reporead/core";

/**
 * GET /api/projects/[slug]/file?path=src/foo.ts&from=10&to=30
 *
 * Returns a snippet of a file from the project's repo root.
 * Line numbers are 1-indexed, inclusive. If `from`/`to` are omitted
 * returns the entire file (capped at 500 lines).
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ slug: string }> },
): Promise<Response> {
  try {
    const { slug } = await params;
    const url = new URL(request.url);
    const filePath = url.searchParams.get("path");
    if (!filePath) {
      return NextResponse.json({ error: "Missing path" }, { status: 400 });
    }

    const repoRoot = process.env.REPOREAD_ROOT ?? process.cwd();
    const storage = new StorageAdapter(repoRoot);

    // Load project config to get actual repo root
    let projectRepoRoot = repoRoot;
    try {
      const config = await loadProjectConfig(storage.paths.projectDir(slug));
      projectRepoRoot = config.repoRoot;
    } catch {
      /* fall back to REPOREAD_ROOT */
    }

    // Security: resolve and ensure within repo
    const absPath = path.resolve(projectRepoRoot, filePath);
    if (!absPath.startsWith(path.resolve(projectRepoRoot) + path.sep)) {
      return NextResponse.json(
        { error: "Path outside repo" },
        { status: 403 },
      );
    }

    let content: string;
    try {
      content = await fs.readFile(absPath, "utf-8");
    } catch {
      return NextResponse.json(
        { error: `File not found: ${filePath}` },
        { status: 404 },
      );
    }

    const lines = content.split("\n");
    const totalLines = lines.length;

    const fromParam = url.searchParams.get("from");
    const toParam = url.searchParams.get("to");

    let from = fromParam ? parseInt(fromParam, 10) : 1;
    let to = toParam ? parseInt(toParam, 10) : Math.min(totalLines, 500);

    if (isNaN(from) || from < 1) from = 1;
    if (isNaN(to) || to > totalLines) to = totalLines;
    if (to < from) to = from;

    // Clamp window to 200 lines max for popover
    if (to - from > 200) to = from + 200;

    const snippet = lines.slice(from - 1, to).join("\n");
    const language = inferLanguage(filePath);

    return NextResponse.json({
      path: filePath,
      from,
      to,
      totalLines,
      language,
      content: snippet,
    });
  } catch (err) {
    return NextResponse.json(
      { error: (err as Error).message },
      { status: 500 },
    );
  }
}

function inferLanguage(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase().slice(1);
  const map: Record<string, string> = {
    ts: "typescript",
    tsx: "tsx",
    js: "javascript",
    jsx: "jsx",
    py: "python",
    rs: "rust",
    go: "go",
    java: "java",
    kt: "kotlin",
    swift: "swift",
    rb: "ruby",
    php: "php",
    c: "c",
    cpp: "cpp",
    h: "cpp",
    hpp: "cpp",
    cs: "csharp",
    sh: "bash",
    bash: "bash",
    zsh: "bash",
    yml: "yaml",
    yaml: "yaml",
    json: "json",
    md: "markdown",
    html: "html",
    css: "css",
    scss: "scss",
    sql: "sql",
    toml: "toml",
    xml: "xml",
  };
  return map[ext] ?? "text";
}
