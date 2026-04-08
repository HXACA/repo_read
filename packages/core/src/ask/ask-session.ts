import { randomUUID } from "node:crypto";
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

  get(sessionId: string): AskSession | undefined {
    return this.sessions.get(sessionId);
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
    const dir = this.storage.paths.projectDir(session.projectSlug);
    const filePath = `${dir}/ask/${sessionId}.json`;
    await this.storage.writeJson(filePath, session);
  }
}
