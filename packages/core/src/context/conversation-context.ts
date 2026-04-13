/**
 * ConversationContextManager — in-memory context shaping for multi-turn
 * conversations. Sits between the persistence layer (AskSessionManager) and
 * prompt construction, replacing hardcoded `turns.slice(-N)` patterns with
 * a configurable context window.
 *
 * Persistence remains the responsibility of AskSessionManager; this class
 * only handles context windowing and (in the future) compact/replay.
 */

export type ConversationScope = {
  projectSlug: string;
  sessionId: string;
};

export type ContextTurn = {
  role: "user" | "assistant";
  content: string;
};

export type ContextViewOptions = {
  /** Maximum number of recent turns to include. Default: all turns. */
  maxTurns?: number;
  /**
   * Approximate token budget for the returned turns.
   * **Not implemented yet** — accepted for forward-compatibility but
   * currently ignored. When implemented, the manager will compact or
   * trim older turns to stay within this budget.
   */
  maxTokensEstimate?: number;
};

export type ContextView = {
  turns: ContextTurn[];
  /** `true` when older turns were omitted from the view. */
  truncated: boolean;
};

function scopeKey(scope: ConversationScope): string {
  return `${scope.projectSlug}::${scope.sessionId}`;
}

export class ConversationContextManager {
  private sessions: Map<string, ContextTurn[]> = new Map();

  /** Record a single turn in the session. */
  addTurn(scope: ConversationScope, turn: ContextTurn): void {
    const key = scopeKey(scope);
    let turns = this.sessions.get(key);
    if (!turns) {
      turns = [];
      this.sessions.set(key, turns);
    }
    turns.push(turn);
  }

  /**
   * Return a windowed view of the conversation for prompt construction.
   *
   * When `maxTurns` is provided, only the most recent N turns are returned
   * and `truncated` is set to `true` if any turns were omitted.
   *
   * `maxTokensEstimate` is accepted but currently ignored (reserved for
   * future compact/replay support).
   */
  getContextView(
    scope: ConversationScope,
    options?: ContextViewOptions,
  ): ContextView {
    const key = scopeKey(scope);
    const all = this.sessions.get(key) ?? [];

    if (options?.maxTurns !== undefined && options.maxTurns < all.length) {
      return {
        turns: all.slice(-options.maxTurns),
        truncated: true,
      };
    }

    return { turns: [...all], truncated: false };
  }

  /**
   * Bulk-load turns into a session. Typically used when hydrating from an
   * existing {@link AskSession} that was loaded from disk.
   */
  loadTurns(scope: ConversationScope, turns: ContextTurn[]): void {
    const key = scopeKey(scope);
    this.sessions.set(key, [...turns]);
  }

  /** Remove all turns for a session. */
  clear(scope: ConversationScope): void {
    const key = scopeKey(scope);
    this.sessions.delete(key);
  }
}
