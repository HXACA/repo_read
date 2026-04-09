import * as path from "node:path";

const REPOREAD_DIR = ".reporead";

export class StoragePaths {
  readonly root: string;

  constructor(repoRoot: string) {
    this.root = path.join(repoRoot, REPOREAD_DIR);
  }

  get currentJson(): string {
    return path.join(this.root, "current.json");
  }

  projectDir(slug: string): string {
    return path.join(this.root, "projects", slug);
  }

  projectJson(slug: string): string {
    return path.join(this.projectDir(slug), "project.json");
  }

  jobDir(slug: string, jobId: string): string {
    return path.join(this.projectDir(slug), "jobs", jobId);
  }

  jobStateJson(slug: string, jobId: string): string {
    return path.join(this.jobDir(slug, jobId), "job-state.json");
  }

  eventsNdjson(slug: string, jobId: string): string {
    return path.join(this.jobDir(slug, jobId), "events.ndjson");
  }

  draftDir(slug: string, jobId: string, versionId: string): string {
    return path.join(this.jobDir(slug, jobId), "draft", versionId);
  }

  draftWikiJson(slug: string, jobId: string, versionId: string): string {
    return path.join(this.draftDir(slug, jobId, versionId), "wiki.json");
  }

  draftPageMd(slug: string, jobId: string, versionId: string, pageSlug: string): string {
    return path.join(this.draftDir(slug, jobId, versionId), "pages", `${pageSlug}.md`);
  }

  draftPageMeta(slug: string, jobId: string, versionId: string, pageSlug: string): string {
    return path.join(this.draftDir(slug, jobId, versionId), "pages", `${pageSlug}.meta.json`);
  }

  reviewJson(slug: string, jobId: string, pageSlug: string): string {
    return path.join(this.jobDir(slug, jobId), "review", `${pageSlug}.review.json`);
  }

  validationJson(slug: string, jobId: string, pageSlug: string): string {
    return path.join(this.jobDir(slug, jobId), "validation", `${pageSlug}.validation.json`);
  }

  versionDir(slug: string, versionId: string): string {
    return path.join(this.projectDir(slug), "versions", versionId);
  }

  versionWikiJson(slug: string, versionId: string): string {
    return path.join(this.versionDir(slug, versionId), "wiki.json");
  }

  versionPageMd(slug: string, versionId: string, pageSlug: string): string {
    return path.join(this.versionDir(slug, versionId), "pages", `${pageSlug}.md`);
  }

  versionPageMeta(slug: string, versionId: string, pageSlug: string): string {
    return path.join(this.versionDir(slug, versionId), "pages", `${pageSlug}.meta.json`);
  }

  draftCitationsJson(slug: string, jobId: string, versionId: string, pageSlug: string): string {
    return path.join(this.draftDir(slug, jobId, versionId), "citations", `${pageSlug}.citations.json`);
  }

  draftVersionJson(slug: string, jobId: string, versionId: string): string {
    return path.join(this.draftDir(slug, jobId, versionId), "version.json");
  }

  versionJson(slug: string, versionId: string): string {
    return path.join(this.versionDir(slug, versionId), "version.json");
  }

  versionCitationsJson(slug: string, versionId: string, pageSlug: string): string {
    return path.join(this.versionDir(slug, versionId), "citations", `${pageSlug}.citations.json`);
  }

  /** Directory holding all research notes for a given project+version. */
  researchDir(slug: string, versionId: string): string {
    return path.join(this.projectDir(slug), "research", versionId);
  }

  /** Single research note file, keyed by UUID. */
  researchNoteJson(slug: string, versionId: string, noteId: string): string {
    return path.join(this.researchDir(slug, versionId), `${noteId}.json`);
  }
}
