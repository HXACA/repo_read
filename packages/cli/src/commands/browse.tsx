import * as path from "node:path";
import * as http from "node:http";
import { StorageAdapter } from "@reporead/core";

export interface BrowseOptions {
  dir: string;
  name?: string;
  port: string;
  page?: string;
}

/**
 * Check if a server is already listening on the given port.
 */
function isPortInUse(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const req = http.get(`http://localhost:${port}`, () => {
      resolve(true);
    });
    req.on("error", () => resolve(false));
    req.setTimeout(1000, () => {
      req.destroy();
      resolve(false);
    });
  });
}

/**
 * Wait until the server on `port` responds, up to `timeoutMs`.
 */
function waitForServer(port: number, timeoutMs = 30000): Promise<boolean> {
  const start = Date.now();
  return new Promise((resolve) => {
    const check = () => {
      if (Date.now() - start > timeoutMs) return resolve(false);
      isPortInUse(port).then((up) => {
        if (up) return resolve(true);
        setTimeout(check, 500);
      });
    };
    check();
  });
}

function openBrowser(url: string): void {
  const { exec } = require("node:child_process") as typeof import("node:child_process");
  const cmd =
    process.platform === "darwin"
      ? "open"
      : process.platform === "win32"
        ? "start"
        : "xdg-open";
  exec(`${cmd} "${url}"`);
}

export async function runBrowse(options: BrowseOptions): Promise<void> {
  const repoRoot = path.resolve(options.dir);
  const slug = options.name ?? path.basename(repoRoot);
  const storage = new StorageAdapter(repoRoot);
  const port = parseInt(options.port, 10);

  // Resolve the URL to open
  const current = await storage.readJson<{ versionId?: string }>(
    storage.paths.currentJson,
  );
  const versionId = current?.versionId;

  let url = `http://localhost:${port}`;
  if (versionId) {
    url += `/projects/${slug}/versions/${versionId}`;
    if (options.page) {
      url += `/pages/${options.page}`;
    }
  }

  // Check if web server is already running
  const alreadyUp = await isPortInUse(port);
  if (alreadyUp) {
    console.log(`Web server already running on port ${port}`);
    console.log(`Opening ${url}`);
    openBrowser(url);
    return;
  }

  // Start the web server
  const webDir = path.resolve(__dirname, "../../..", "web");
  // Try to find the web package in the monorepo or as a peer install
  const { spawn } = await import("node:child_process");
  const possibleWebDirs = [
    path.resolve(__dirname, "../../../web"),              // monorepo: packages/web
    path.resolve(__dirname, "../../../../packages/web"),  // from dist
  ];

  let webPkgDir: string | null = null;
  const fs = await import("node:fs");
  for (const d of possibleWebDirs) {
    if (fs.existsSync(path.join(d, "package.json"))) {
      webPkgDir = d;
      break;
    }
  }

  if (!webPkgDir) {
    console.error(
      "Could not find @reporead/web package. Start the web server manually:\n" +
        `  cd packages/web && REPOREAD_ROOT=${repoRoot} npx next dev --port ${port}`,
    );
    process.exitCode = 1;
    return;
  }

  console.log(`Starting web server on port ${port}...`);

  const child = spawn("npx", ["next", "dev", "--port", String(port)], {
    cwd: webPkgDir,
    env: { ...process.env, REPOREAD_ROOT: repoRoot },
    stdio: "pipe",
    detached: false,
  });

  // Forward next dev output dimmed
  child.stdout?.on("data", (data: Buffer) => {
    const lines = data.toString().split("\n").filter(Boolean);
    for (const line of lines) {
      if (line.includes("Ready")) {
        // next dev prints "Ready in Xs" — open browser when we see this
      }
      process.stderr.write(`  \x1b[2m${line}\x1b[0m\n`);
    }
  });
  child.stderr?.on("data", (data: Buffer) => {
    process.stderr.write(`  \x1b[2m${data.toString()}\x1b[0m`);
  });

  // Wait for server to be ready
  console.log("Waiting for server...");
  const ready = await waitForServer(port);
  if (!ready) {
    console.error("Server did not start in time. Check for errors above.");
    child.kill();
    process.exitCode = 1;
    return;
  }

  console.log(`Opening ${url}`);
  openBrowser(url);

  // Keep the process alive — Ctrl+C will kill both CLI and next dev
  console.log(`\nWeb server running. Press Ctrl+C to stop.\n`);

  process.on("SIGINT", () => {
    child.kill();
    process.exit(0);
  });
  process.on("SIGTERM", () => {
    child.kill();
    process.exit(0);
  });

  // Keep alive
  await new Promise(() => {});
}
