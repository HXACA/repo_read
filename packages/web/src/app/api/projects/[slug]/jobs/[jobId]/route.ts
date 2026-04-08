import { NextResponse } from "next/server";
import { StorageAdapter } from "@reporead/core";
import type { GenerationJob } from "@reporead/core";

function getStorage(): StorageAdapter {
  const repoRoot = process.env.REPOREAD_ROOT ?? process.cwd();
  return new StorageAdapter(repoRoot);
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ slug: string; jobId: string }> },
) {
  try {
    const { slug, jobId } = await params;
    const storage = getStorage();
    const job = await storage.readJson<GenerationJob>(
      storage.paths.jobStateJson(slug, jobId),
    );

    if (!job) {
      return NextResponse.json({ error: "Job not found" }, { status: 404 });
    }

    return NextResponse.json({ job });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
