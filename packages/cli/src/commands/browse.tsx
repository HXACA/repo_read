import * as path from "node:path";
import { StorageAdapter } from "@reporead/core";

export interface BrowseOptions {
  dir: string;
  name?: string;
  port: string;
  page?: string;
}

export async function runBrowse(options: BrowseOptions): Promise<void> {
  const repoRoot = path.resolve(options.dir);
  const slug = options.name ?? path.basename(repoRoot);
  const storage = new StorageAdapter(repoRoot);

  const current = await storage.readJson<{ versionId?: string }>(storage.paths.currentJson);
  const versionId = current?.versionId;

  let url = `http://localhost:${options.port}`;
  if (versionId) {
    url += `/projects/${slug}/versions/${versionId}`;
    if (options.page) {
      url += `/pages/${options.page}`;
    }
  }

  console.log(`Opening ${url}`);

  // Open browser cross-platform
  const { exec } = await import("node:child_process");
  const platform = process.platform;
  const cmd = platform === "darwin" ? "open" : platform === "win32" ? "start" : "xdg-open";
  exec(`${cmd} "${url}"`);
}
