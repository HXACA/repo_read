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
    return this.storage.readJson<ProjectInfo>(
      this.storage.paths.projectJson(slug),
    );
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
}
