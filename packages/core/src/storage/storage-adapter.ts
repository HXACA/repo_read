import * as fs from "node:fs/promises";
import * as path from "node:path";
import { AppError } from "../errors.js";
import { StoragePaths } from "./paths.js";

export class StorageAdapter {
  readonly paths: StoragePaths;

  constructor(repoRoot: string) {
    this.paths = new StoragePaths(repoRoot);
  }

  async initialize(): Promise<void> {
    await fs.mkdir(this.paths.root, { recursive: true });
  }

  async readJson<T>(filePath: string): Promise<T | null> {
    try {
      const raw = await fs.readFile(filePath, "utf-8");
      return JSON.parse(raw) as T;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") {
        return null;
      }
      throw new AppError("STORAGE_READ_ERROR", `Failed to read ${filePath}`, {
        path: filePath,
        error: String(err),
      });
    }
  }

  async writeJson(filePath: string, data: unknown): Promise<void> {
    try {
      await fs.mkdir(path.dirname(filePath), { recursive: true });
      await fs.writeFile(filePath, JSON.stringify(data, null, 2), "utf-8");
    } catch (err) {
      throw new AppError("STORAGE_WRITE_ERROR", `Failed to write ${filePath}`, {
        path: filePath,
        error: String(err),
      });
    }
  }

  async appendLine(filePath: string, line: string): Promise<void> {
    try {
      await fs.mkdir(path.dirname(filePath), { recursive: true });
      await fs.appendFile(filePath, line + "\n", "utf-8");
    } catch (err) {
      throw new AppError("STORAGE_WRITE_ERROR", `Failed to append to ${filePath}`, {
        path: filePath,
        error: String(err),
      });
    }
  }

  async exists(filePath: string): Promise<boolean> {
    try {
      await fs.access(filePath);
      return true;
    } catch {
      return false;
    }
  }

  async promoteVersion(
    projectSlug: string,
    jobId: string,
    versionId: string,
  ): Promise<void> {
    const draftPath = this.paths.draftDir(projectSlug, jobId, versionId);
    const versionPath = this.paths.versionDir(projectSlug, versionId);

    try {
      await fs.mkdir(path.dirname(versionPath), { recursive: true });
      await fs.rename(draftPath, versionPath);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "EXDEV") {
        await fs.cp(draftPath, versionPath, { recursive: true });
        await fs.rm(draftPath, { recursive: true, force: true });
      } else {
        throw new AppError("STORAGE_WRITE_ERROR", `Failed to promote version ${versionId}`, {
          error: String(err),
        });
      }
    }
  }
}
