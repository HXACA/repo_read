import { NextResponse } from "next/server";
import { StorageAdapter } from "@reporead/core";
import type { VersionJson, WikiJson } from "@reporead/core";

function getStorage(): StorageAdapter {
  const repoRoot = process.env.REPOREAD_ROOT ?? process.cwd();
  return new StorageAdapter(repoRoot);
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ slug: string; versionId: string }> },
) {
  try {
    const { slug, versionId } = await params;
    const storage = getStorage();

    const wiki = await storage.readJson<WikiJson>(
      storage.paths.versionWikiJson(slug, versionId),
    );
    const version = await storage.readJson<VersionJson>(
      storage.paths.versionJson(slug, versionId),
    );

    if (!wiki && !version) {
      return NextResponse.json({ error: "Version not found" }, { status: 404 });
    }

    return NextResponse.json({ wiki, version });
  } catch (err) {
    return NextResponse.json(
      { error: (err as Error).message },
      { status: 500 },
    );
  }
}
