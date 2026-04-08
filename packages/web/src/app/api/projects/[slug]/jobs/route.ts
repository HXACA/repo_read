import * as fs from "node:fs/promises";
import * as path from "node:path";
import { NextResponse } from "next/server";
import { StorageAdapter } from "@reporead/core";
import type { GenerationJob } from "@reporead/core";

function getStorage(): StorageAdapter {
  const repoRoot = process.env.REPOREAD_ROOT ?? process.cwd();
  return new StorageAdapter(repoRoot);
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ slug: string }> },
) {
  try {
    const { slug } = await params;
    const storage = getStorage();
    const jobsDir = path.join(storage.paths.projectDir(slug), "jobs");

    let dirs: string[];
    try {
      dirs = await fs.readdir(jobsDir);
    } catch {
      return NextResponse.json({ jobs: [] });
    }

    const jobs: GenerationJob[] = [];
    for (const dir of dirs) {
      const statePath = path.join(jobsDir, dir, "job-state.json");
      try {
        const raw = await fs.readFile(statePath, "utf-8");
        jobs.push(JSON.parse(raw));
      } catch {
        continue;
      }
    }

    jobs.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    return NextResponse.json({ jobs });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
