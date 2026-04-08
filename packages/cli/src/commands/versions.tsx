import * as path from "node:path";
import * as fs from "node:fs/promises";
import { StorageAdapter } from "@reporead/core";
import type { VersionJson } from "@reporead/core";

export interface VersionsOptions {
  dir: string;
  name?: string;
}

export async function runVersions(options: VersionsOptions): Promise<void> {
  const repoRoot = path.resolve(options.dir);
  const slug = options.name ?? path.basename(repoRoot);
  const storage = new StorageAdapter(repoRoot);

  const versionsDir = path.join(storage.paths.projectDir(slug), "versions");

  let versionDirs: string[];
  try {
    versionDirs = await fs.readdir(versionsDir);
  } catch {
    console.log(`No versions found for project "${slug}".`);
    return;
  }

  const current = await storage.readJson<{ versionId?: string }>(storage.paths.currentJson);

  const versions: VersionJson[] = [];
  for (const dir of versionDirs) {
    const vPath = path.join(versionsDir, dir, "version.json");
    try {
      const raw = await fs.readFile(vPath, "utf-8");
      versions.push(JSON.parse(raw) as VersionJson);
    } catch {
      // Skip invalid version directories
    }
  }

  if (versions.length === 0) {
    console.log(`No versions found for project "${slug}".`);
    return;
  }

  versions.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

  console.log(`Versions for "${slug}":\n`);
  for (const v of versions) {
    const isCurrent = v.versionId === current?.versionId ? " (current)" : "";
    const date = new Date(v.createdAt).toLocaleDateString();
    console.log(`  ${v.versionId}  ${v.pageCount} pages  ${v.commitHash.slice(0, 8)}  ${date}${isCurrent}`);
  }
}
