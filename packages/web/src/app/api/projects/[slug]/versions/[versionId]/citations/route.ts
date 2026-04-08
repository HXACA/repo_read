import { NextResponse } from "next/server";
import { StorageAdapter } from "@reporead/core";
import type { WikiJson, CitationRecord } from "@reporead/core";

function getStorage(): StorageAdapter {
  const repoRoot = process.env.REPOREAD_ROOT ?? process.cwd();
  return new StorageAdapter(repoRoot);
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ slug: string; versionId: string }> },
): Promise<Response> {
  try {
    const { slug, versionId } = await params;
    const storage = getStorage();

    const wiki = await storage.readJson<WikiJson>(
      storage.paths.versionWikiJson(slug, versionId),
    );
    if (!wiki) {
      return NextResponse.json({ error: "Version not found" }, { status: 404 });
    }

    const allCitations: Array<{ pageSlug: string; citations: CitationRecord[] }> = [];
    for (const page of wiki.reading_order) {
      const citations = await storage.readJson<CitationRecord[]>(
        storage.paths.versionCitationsJson(slug, versionId, page.slug),
      );
      allCitations.push({ pageSlug: page.slug, citations: citations ?? [] });
    }

    return NextResponse.json({ citations: allCitations });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
