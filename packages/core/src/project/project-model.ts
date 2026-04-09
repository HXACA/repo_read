import * as fs from "node:fs/promises";
import * as path from "node:path";
import { AppError } from "../errors.js";
import type { StorageAdapter } from "../storage/storage-adapter.js";
import type { ProjectInfo } from "../types/project.js";

export interface CreateProjectInput {
  projectSlug: string;
  repoRoot: string;
  branch: string;
}

export class ProjectModel {
  constructor(private readonly storage: StorageAdapter) {}

  async create(input: CreateProjectInput): Promise<ProjectInfo> {
    const existing = await this.get(input.projectSlug);
    if (existing) {
      throw new AppError("PROJECT_ALREADY_EXISTS", `Project "${input.projectSlug}" already exists`);
    }

    const now = new Date().toISOString();
    const project: ProjectInfo = {
      projectSlug: input.projectSlug,
      repoRoot: input.repoRoot,
      branch: input.branch,
      createdAt: now,
      updatedAt: now,
    };

    await this.storage.writeJson(
      this.storage.paths.projectJson(input.projectSlug),
      project,
    );

    return project;
  }

  async get(slug: string): Promise<ProjectInfo | null> {
    const project = await this.storage.readJson<ProjectInfo>(
      this.storage.paths.projectJson(slug),
    );
    if (!project) return null;

    // Backfill latestVersionId from current.json if missing
    if (!project.latestVersionId) {
      const current = await this.storage.readJson<{
        projectSlug: string;
        versionId: string;
      }>(this.storage.paths.currentJson);
      if (current && current.projectSlug === slug && current.versionId) {
        project.latestVersionId = current.versionId;
      }
    }

    return project;
  }

  async update(slug: string, updates: Partial<Pick<ProjectInfo, "latestVersionId" | "repoProfile">>): Promise<ProjectInfo> {
    const project = await this.get(slug);
    if (!project) {
      throw new AppError("PROJECT_NOT_FOUND", `Project "${slug}" not found`);
    }
    const updated: ProjectInfo = {
      ...project,
      ...updates,
      updatedAt: new Date().toISOString(),
    };
    await this.storage.writeJson(this.storage.paths.projectJson(slug), updated);
    return updated;
  }

  async list(): Promise<ProjectInfo[]> {
    const projectsDir = path.join(this.storage.paths.root, "projects");
    let entries: string[];
    try {
      entries = await fs.readdir(projectsDir);
    } catch {
      return [];
    }

    const projects: ProjectInfo[] = [];
    for (const entry of entries) {
      const project = await this.get(entry);
      if (project) projects.push(project);
    }
    return projects;
  }

  /**
   * List all published versions for a project, newest first.
   */
  async listVersions(slug: string): Promise<
    Array<{
      versionId: string;
      createdAt: string;
      pageCount: number;
      commitHash: string;
      summary: string;
    }>
  > {
    const versionsDir = path.join(
      this.storage.paths.projectDir(slug),
      "versions",
    );
    let entries: string[];
    try {
      entries = await fs.readdir(versionsDir);
    } catch {
      return [];
    }

    const versions: Array<{
      versionId: string;
      createdAt: string;
      pageCount: number;
      commitHash: string;
      summary: string;
    }> = [];

    for (const versionId of entries) {
      const versionJson = await this.storage.readJson<{
        versionId: string;
        createdAt: string;
        pageCount: number;
        commitHash: string;
        summary: string;
      }>(this.storage.paths.versionJson(slug, versionId));
      if (versionJson) {
        versions.push({
          versionId,
          createdAt: versionJson.createdAt,
          pageCount: versionJson.pageCount,
          commitHash: versionJson.commitHash,
          summary: versionJson.summary,
        });
      }
    }

    // Newest first
    versions.sort(
      (a, b) =>
        new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
    );
    return versions;
  }
}
