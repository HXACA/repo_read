import { describe, it, expect, beforeEach } from "vitest";
import {
  ConversationContextManager,
  type ConversationScope,
  type ContextTurn,
} from "../conversation-context.js";

describe("ConversationContextManager", () => {
  let manager: ConversationContextManager;
  const scope: ConversationScope = {
    projectSlug: "proj",
    sessionId: "sess-1",
  };

  beforeEach(() => {
    manager = new ConversationContextManager();
  });

  it("addTurn + getContextView returns all turns", () => {
    manager.addTurn(scope, { role: "user", content: "Hello" });
    manager.addTurn(scope, { role: "assistant", content: "Hi there" });
    manager.addTurn(scope, { role: "user", content: "How?" });

    const view = manager.getContextView(scope);
    expect(view.turns).toHaveLength(3);
    expect(view.truncated).toBe(false);
    expect(view.turns[0]).toEqual({ role: "user", content: "Hello" });
    expect(view.turns[2]).toEqual({ role: "user", content: "How?" });
  });

  it("getContextView with maxTurns truncates correctly", () => {
    manager.addTurn(scope, { role: "user", content: "t1" });
    manager.addTurn(scope, { role: "assistant", content: "t2" });
    manager.addTurn(scope, { role: "user", content: "t3" });
    manager.addTurn(scope, { role: "assistant", content: "t4" });
    manager.addTurn(scope, { role: "user", content: "t5" });

    const view = manager.getContextView(scope, { maxTurns: 2 });
    expect(view.turns).toHaveLength(2);
    expect(view.truncated).toBe(true);
    // Should return the most recent 2 turns
    expect(view.turns[0].content).toBe("t4");
    expect(view.turns[1].content).toBe("t5");
  });

  it("getContextView with maxTurns >= total does not truncate", () => {
    manager.addTurn(scope, { role: "user", content: "a" });
    manager.addTurn(scope, { role: "assistant", content: "b" });

    const view = manager.getContextView(scope, { maxTurns: 10 });
    expect(view.turns).toHaveLength(2);
    expect(view.truncated).toBe(false);
  });

  it("getContextView with maxTurns equal to total does not truncate", () => {
    manager.addTurn(scope, { role: "user", content: "a" });
    manager.addTurn(scope, { role: "assistant", content: "b" });

    const view = manager.getContextView(scope, { maxTurns: 2 });
    expect(view.turns).toHaveLength(2);
    expect(view.truncated).toBe(false);
  });

  it("loadTurns initializes from existing data", () => {
    const existing: ContextTurn[] = [
      { role: "user", content: "old question" },
      { role: "assistant", content: "old answer" },
    ];
    manager.loadTurns(scope, existing);

    const view = manager.getContextView(scope);
    expect(view.turns).toHaveLength(2);
    expect(view.turns[0].content).toBe("old question");

    // Verify it's a copy — mutating the input array shouldn't affect the manager
    existing.push({ role: "user", content: "sneaky" });
    expect(manager.getContextView(scope).turns).toHaveLength(2);
  });

  it("loadTurns overwrites previous turns", () => {
    manager.addTurn(scope, { role: "user", content: "first" });
    manager.loadTurns(scope, [{ role: "user", content: "replaced" }]);

    const view = manager.getContextView(scope);
    expect(view.turns).toHaveLength(1);
    expect(view.turns[0].content).toBe("replaced");
  });

  it("clear removes all turns for a session", () => {
    manager.addTurn(scope, { role: "user", content: "a" });
    manager.addTurn(scope, { role: "assistant", content: "b" });

    manager.clear(scope);

    const view = manager.getContextView(scope);
    expect(view.turns).toHaveLength(0);
    expect(view.truncated).toBe(false);
  });

  it("separate sessions don't interfere", () => {
    const scopeA: ConversationScope = {
      projectSlug: "proj",
      sessionId: "sess-A",
    };
    const scopeB: ConversationScope = {
      projectSlug: "proj",
      sessionId: "sess-B",
    };

    manager.addTurn(scopeA, { role: "user", content: "from A" });
    manager.addTurn(scopeB, { role: "user", content: "from B" });
    manager.addTurn(scopeB, { role: "assistant", content: "reply B" });

    const viewA = manager.getContextView(scopeA);
    const viewB = manager.getContextView(scopeB);

    expect(viewA.turns).toHaveLength(1);
    expect(viewA.turns[0].content).toBe("from A");
    expect(viewB.turns).toHaveLength(2);
    expect(viewB.turns[0].content).toBe("from B");
  });

  it("separate projects with same sessionId don't interfere", () => {
    const scopeX: ConversationScope = {
      projectSlug: "proj-x",
      sessionId: "shared-id",
    };
    const scopeY: ConversationScope = {
      projectSlug: "proj-y",
      sessionId: "shared-id",
    };

    manager.addTurn(scopeX, { role: "user", content: "X" });
    manager.addTurn(scopeY, { role: "user", content: "Y" });

    expect(manager.getContextView(scopeX).turns).toHaveLength(1);
    expect(manager.getContextView(scopeY).turns).toHaveLength(1);
    expect(manager.getContextView(scopeX).turns[0].content).toBe("X");
    expect(manager.getContextView(scopeY).turns[0].content).toBe("Y");
  });

  it("getContextView on empty/unknown session returns empty", () => {
    const unknown: ConversationScope = {
      projectSlug: "nope",
      sessionId: "nope",
    };
    const view = manager.getContextView(unknown);
    expect(view.turns).toHaveLength(0);
    expect(view.truncated).toBe(false);
  });

  it("maxTokensEstimate is accepted but does not affect output", () => {
    manager.addTurn(scope, { role: "user", content: "a" });
    manager.addTurn(scope, { role: "assistant", content: "b" });

    // maxTokensEstimate is a no-op for now — all turns should still be returned
    const view = manager.getContextView(scope, { maxTokensEstimate: 1 });
    expect(view.turns).toHaveLength(2);
    expect(view.truncated).toBe(false);
  });
});
