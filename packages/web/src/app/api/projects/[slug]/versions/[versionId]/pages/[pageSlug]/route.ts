import { NextResponse } from "next/server";
import * as fs from "node:fs/promises";
import { StorageAdapter } from "@reporead/core";
import type { PageMeta } from "@reporead/core";

function getStorage(): StorageAdapter {
  const repoRoot = process.env.REPOREAD_ROOT ?? process.cwd();
  return new StorageAdapter(repoRoot);
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ slug: string; versionId: string; pageSlug: string }> },
) {
  try {
    const { slug, versionId, pageSlug } = await params;
    const storage = getStorage();

    const mdPath = storage.paths.versionPageMd(slug, versionId, pageSlug);
    const metaPath = storage.paths.versionPageMeta(slug, versionId, pageSlug);

    let markdown: string;
    try {
      markdown = await fs.readFile(mdPath, "utf-8");
    } catch {
      return NextResponse.json({ error: "Page not found" }, { status: 404 });
    }

    const meta = await storage.readJson<PageMeta>(metaPath);

    return NextResponse.json({ markdown, meta });
  } catch (err) {
    return NextResponse.json(
      { error: (err as Error).message },
      { status: 500 },
    );
  }
}
