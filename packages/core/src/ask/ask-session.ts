import { randomUUID } from "node:crypto";
import * as fs from "node:fs/promises";
import type { StorageAdapter } from "../storage/storage-adapter.js";
import type { AskSession } from "../types/events.js";
import type { CitationRecord } from "../types/generation.js";

export class AskSessionManager {
  private sessions: Map<string, AskSession> = new Map();

  constructor(private readonly storage: StorageAdapter) {}

  create(projectSlug: string, versionId: string, currentPageSlug?: string): AskSession {
    const session: AskSession = {
      id: randomUUID(),
      projectSlug,
      versionId,
      mode: "ask",
      currentPageSlug,
      turns: [],
      updatedAt: new Date().toISOString(),
    };
    this.sessions.set(session.id, session);
    return session;
  }

  async get(sessionId: string, projectSlug?: string): Promise<AskSession | undefined> {
    const cached = this.sessions.get(sessionId);
    if (cached) return cached;

    if (projectSlug) {
      const filePath = this.storage.paths.askSessionJson(projectSlug, sessionId);
      const loaded = await this.storage.readJson<AskSession>(filePath);
      if (loaded) {
        this.sessions.set(loaded.id, loaded);
        return loaded;
      }
    }

    return undefined;
  }

  addUserTurn(sessionId: string, content: string): void {
    const session = this.sessions.get(sessionId);
    if (!session) return;
    session.turns.push({ role: "user", content, citations: [] });
    session.updatedAt = new Date().toISOString();
  }

  addAssistantTurn(sessionId: string, content: string, citations: CitationRecord[]): void {
    const session = this.sessions.get(sessionId);
    if (!session) return;
    session.turns.push({ role: "assistant", content, citations });
    session.updatedAt = new Date().toISOString();
  }

  async persist(sessionId: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session) return;
    const filePath = this.storage.paths.askSessionJson(session.projectSlug, sessionId);
    await this.storage.writeJson(filePath, session);
  }

  async list(projectSlug: string): Promise<AskSession[]> {
    const dir = this.storage.paths.askDir(projectSlug);
    let entries: string[];
    try {
      entries = await fs.readdir(dir);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") {
        return [];
      }
      throw err;
    }

    const sessions: AskSession[] = [];
    for (const entry of entries) {
      if (!entry.endsWith(".json")) continue;
      const sessionId = entry.replace(/\.json$/, "");
      const filePath = this.storage.paths.askSessionJson(projectSlug, sessionId);
      const loaded = await this.storage.readJson<AskSession>(filePath);
      if (loaded) {
        this.sessions.set(loaded.id, loaded);
        sessions.push(loaded);
      }
    }
    return sessions;
  }
}
