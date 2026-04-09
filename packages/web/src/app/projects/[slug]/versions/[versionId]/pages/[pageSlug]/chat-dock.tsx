"use client";

import { useState, useRef, useEffect } from "react";
import { useSettings } from "@/lib/settings-context";
import { t } from "@/lib/i18n";
import { MarkdownRenderer } from "./markdown-renderer";

type Citation = {
  kind: string;
  target: string;
  locator?: string;
  note?: string;
};

type Turn = {
  role: "user" | "assistant";
  content: string;
  thinking: string;
  toolCalls: string[];
  citations: Citation[];
  streaming: boolean;
};

/** localStorage key — version-scoped so chat persists across page navigation */
function storageKey(slug: string, versionId: string): string {
  return `reporead-chat-${slug}-${versionId}`;
}

type PersistedChat = {
  turns: Turn[];
  sessionId?: string;
  isOpen?: boolean;
};

function loadChat(slug: string, versionId: string): PersistedChat {
  if (typeof window === "undefined") return { turns: [] };
  try {
    const raw = localStorage.getItem(storageKey(slug, versionId));
    if (!raw) return { turns: [] };
    const parsed = JSON.parse(raw) as PersistedChat;
    // Strip any lingering streaming flag
    parsed.turns = (parsed.turns ?? []).map((t) => ({ ...t, streaming: false }));
    return parsed;
  } catch {
    return { turns: [] };
  }
}

function saveChat(
  slug: string,
  versionId: string,
  turns: Turn[],
  sessionId: string | undefined,
  isOpen: boolean,
) {
  try {
    // Only persist non-streaming turns
    const clean = turns
      .filter((t) => !t.streaming)
      .map(({ role, content, thinking, toolCalls, citations }) => ({
        role,
        content,
        thinking,
        toolCalls,
        citations,
        streaming: false,
      }));
    localStorage.setItem(
      storageKey(slug, versionId),
      JSON.stringify({ turns: clean, sessionId, isOpen }),
    );
  } catch {
    /* ignore */
  }
}

export function ChatDock({
  slug,
  versionId,
  pageSlug,
}: {
  slug: string;
  versionId: string;
  pageSlug: string;
}) {
  const { locale } = useSettings();
  const [isOpen, setIsOpen] = useState(false);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [sessionId, setSessionId] = useState<string | undefined>();
  const [hydrated, setHydrated] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  // Load persisted chat on mount
  useEffect(() => {
    const state = loadChat(slug, versionId);
    if (state.turns.length > 0) setTurns(state.turns);
    if (state.sessionId) setSessionId(state.sessionId);
    if (state.isOpen) setIsOpen(true);
    setHydrated(true);
  }, [slug, versionId]);

  // Persist whenever turns / sessionId / isOpen change (after hydration)
  useEffect(() => {
    if (!hydrated) return;
    saveChat(slug, versionId, turns, sessionId, isOpen);
  }, [hydrated, slug, versionId, turns, sessionId, isOpen]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [turns]);

  const clearHistory = () => {
    if (loading) return;
    setTurns([]);
    setSessionId(undefined);
    try {
      localStorage.removeItem(storageKey(slug, versionId));
    } catch {
      /* ignore */
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || loading) return;

    const question = input.trim();
    setInput("");
    setLoading(true);

    // Add user turn and placeholder assistant turn
    setTurns((prev) => [
      ...prev,
      {
        role: "user",
        content: question,
        thinking: "",
        toolCalls: [],
        citations: [],
        streaming: false,
      },
      {
        role: "assistant",
        content: "",
        thinking: "",
        toolCalls: [],
        citations: [],
        streaming: true,
      },
    ]);

    try {
      const res = await fetch(
        `/api/projects/${slug}/versions/${versionId}/ask`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            question,
            currentPageSlug: pageSlug,
            sessionId,
          }),
        },
      );

      if (!res.ok || !res.body) {
        const errText = await res.text();
        setTurns((prev) => {
          const copy = [...prev];
          const last = copy[copy.length - 1];
          last.content = `Error: ${errText}`;
          last.streaming = false;
          return copy;
        });
        return;
      }

      // Parse SSE stream
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });

        // Split by SSE delimiter
        const events = buffer.split("\n\n");
        buffer = events.pop() ?? "";

        for (const evt of events) {
          const line = evt.trim();
          if (!line.startsWith("data: ")) continue;
          try {
            const data = JSON.parse(line.slice(6));
            setTurns((prev) => {
              const copy = [...prev];
              const last = copy[copy.length - 1];
              switch (data.type) {
                case "session":
                  if (data.sessionId) setSessionId(data.sessionId);
                  break;
                case "reasoning-delta":
                  last.thinking += data.text;
                  break;
                case "text-delta":
                  last.content += data.text;
                  break;
                case "tool-call":
                  last.toolCalls.push(data.toolName);
                  break;
                case "citations":
                  last.citations = data.citations;
                  break;
                case "done":
                  last.streaming = false;
                  // Strip trailing JSON citations block
                  last.content = last.content
                    .replace(/```json\s*\n[\s\S]*?\n```\s*$/, "")
                    .trim();
                  // Sanitize: strip disallowed markdown structures
                  last.content = last.content
                    // Convert any headings to bold (safety net if LLM ignores prompt)
                    .replace(/^(#{1,6})\s+(.+)$/gm, (_m, _h, title) => `**${title.trim()}**`)
                    // Strip horizontal rules
                    .replace(/^---+$/gm, "")
                    // Strip block quotes
                    .replace(/^>\s?/gm, "")
                    // Collapse excessive blank lines
                    .replace(/\n{3,}/g, "\n\n")
                    .trim();
                  break;
                case "error":
                  last.content += `\n\n[Error: ${data.message}]`;
                  last.streaming = false;
                  break;
              }
              return copy;
            });
          } catch {
            /* skip malformed */
          }
        }
      }
    } catch (err) {
      setTurns((prev) => {
        const copy = [...prev];
        const last = copy[copy.length - 1];
        last.content = `Error: ${(err as Error).message}`;
        last.streaming = false;
        return copy;
      });
    } finally {
      setLoading(false);
    }
  };

  if (!isOpen) {
    return (
      <button
        onClick={() => setIsOpen(true)}
        className="fixed bottom-6 right-6 z-50 flex h-12 w-12 items-center justify-center rounded-full text-white"
        style={{
          background: "var(--rr-accent)",
          boxShadow: "0 4px 16px rgba(180, 83, 9, 0.3)",
        }}
        title={t(locale, "askTitle")}
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          className="h-5 w-5"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2}
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z"
          />
        </svg>
      </button>
    );
  }

  return (
    <div
      className="chat-dock fixed bottom-0 right-0 z-50 flex h-[560px] w-[440px] flex-col overflow-hidden"
      style={{
        background: "var(--rr-bg-elevated)",
        border: "1px solid var(--rr-border)",
        borderRadius: "var(--rr-radius) 0 0 0",
        boxShadow: "var(--rr-shadow-lg)",
      }}
    >
      {/* Header */}
      <div
        className="flex items-center justify-between px-3 py-2"
        style={{ borderBottom: "1px solid var(--rr-border)" }}
      >
        <h3
          className="text-xs font-semibold"
          style={{
            fontFamily: "var(--font-display), Georgia, serif",
            color: "var(--rr-text)",
          }}
        >
          {locale === "zh" ? "询问此 Wiki" : "Ask this wiki"}
        </h3>
        <div className="flex items-center gap-1">
          {turns.length > 0 && (
            <button
              onClick={clearHistory}
              className="rounded px-1.5 py-0.5 hover:bg-black/5"
              style={{
                color: "var(--rr-text-muted)",
                fontSize: "10px",
              }}
              title={locale === "zh" ? "清除对话" : "Clear chat"}
            >
              {locale === "zh" ? "清除" : "Clear"}
            </button>
          )}
          <button
            onClick={() => setIsOpen(false)}
            className="flex h-5 w-5 items-center justify-center rounded text-base leading-none hover:bg-black/5"
            style={{ color: "var(--rr-text-muted)" }}
            title={locale === "zh" ? "关闭" : "Close"}
          >
            &times;
          </button>
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 space-y-3 overflow-y-auto px-3 py-3">
        {turns.length === 0 && (
          <p
            className="text-center text-xs leading-relaxed"
            style={{ color: "var(--rr-text-muted)" }}
          >
            {locale === "zh"
              ? "就整个 Wiki 向我提问。\n我会检索仓库并给出带引用的回答。"
              : "Ask me anything about this wiki.\nI'll search the repo and cite sources."}
          </p>
        )}
        {turns.map((turn, i) => (
          <div key={i}>
            {turn.role === "user" ? (
              <div className="text-right">
                <div
                  className="inline-block max-w-[85%] rounded-lg px-2.5 py-1.5 text-xs leading-relaxed"
                  style={{ background: "var(--rr-accent)", color: "#fff" }}
                >
                  {turn.content}
                </div>
              </div>
            ) : (
              <AssistantMessage
                turn={turn}
                locale={locale}
                slug={slug}
                versionId={versionId}
              />
            )}
          </div>
        ))}
        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <form
        onSubmit={handleSubmit}
        className="px-3 py-2"
        style={{ borderTop: "1px solid var(--rr-border)" }}
      >
        <div className="flex gap-1.5">
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={t(locale, "askPlaceholder")}
            className="flex-1 rounded-md px-2.5 py-1.5 text-xs outline-none"
            style={{
              background: "var(--rr-bg-surface)",
              color: "var(--rr-text)",
              border: "1px solid var(--rr-border)",
            }}
            disabled={loading}
          />
          <button
            type="submit"
            disabled={loading || !input.trim()}
            className="rounded-md px-3 py-1.5 text-xs font-medium text-white disabled:opacity-40"
            style={{ background: "var(--rr-accent)" }}
          >
            {t(locale, "send")}
          </button>
        </div>
      </form>
    </div>
  );
}

function AssistantMessage({
  turn,
  locale,
  slug,
  versionId,
}: {
  turn: Turn;
  locale: "zh" | "en";
  slug: string;
  versionId: string;
}) {
  const [thinkingOpen, setThinkingOpen] = useState(false);
  const zh = locale === "zh";
  const hasThinking = turn.thinking.length > 0;
  const hasToolCalls = turn.toolCalls.length > 0;

  return (
    <div>
      {/* Thinking block */}
      {hasThinking && (
        <div
          className="mb-1.5 rounded-md"
          style={{
            background: "var(--rr-bg-surface)",
            border: "1px solid var(--rr-border)",
          }}
        >
          <button
            onClick={() => setThinkingOpen(!thinkingOpen)}
            className="flex w-full items-center gap-1.5 px-2.5 py-1.5 text-left"
            style={{ color: "var(--rr-text-secondary)", fontSize: "11px" }}
          >
            <span
              style={{
                transform: thinkingOpen ? "rotate(90deg)" : "none",
                transition: "transform 0.15s",
              }}
            >
              &rsaquo;
            </span>
            <span className="font-medium">
              {turn.streaming
                ? zh
                  ? "思考中..."
                  : "Thinking..."
                : zh
                  ? "思考过程"
                  : "Thinking"}
            </span>
            <span style={{ color: "var(--rr-text-muted)" }}>
              · {turn.thinking.length}
            </span>
          </button>
          {thinkingOpen && (
            <div
              className="whitespace-pre-wrap px-2.5 pb-2 leading-relaxed"
              style={{
                color: "var(--rr-text-muted)",
                fontFamily: "var(--font-mono), monospace",
                borderTop: "1px solid var(--rr-border)",
                paddingTop: "0.375rem",
                fontSize: "11px",
              }}
            >
              {turn.thinking}
            </div>
          )}
        </div>
      )}

      {/* Tool calls indicator */}
      {hasToolCalls && (
        <div
          className="mb-1.5 flex flex-wrap gap-1"
          style={{ color: "var(--rr-text-muted)", fontSize: "10px" }}
        >
          {turn.toolCalls.map((tool, idx) => (
            <span
              key={idx}
              className="inline-flex items-center gap-0.5 rounded px-1.5 py-0.5"
              style={{
                background: "var(--rr-bg-surface)",
                border: "1px solid var(--rr-border)",
                fontFamily: "var(--font-mono), monospace",
              }}
            >
              <span>&#9881;</span>
              {tool}
            </span>
          ))}
        </div>
      )}

      {/* Main answer */}
      {turn.content && (
        <div
          className="chat-answer rounded-md px-2.5 py-2"
          style={{
            background: "var(--rr-bg-surface)",
            color: "var(--rr-text)",
            border: "1px solid var(--rr-border)",
            fontSize: "12px",
            lineHeight: "1.65",
          }}
        >
          <MarkdownRenderer
            content={turn.content}
            slug={slug}
            versionId={versionId}
          />
        </div>
      )}

      {/* Streaming indicator */}
      {turn.streaming && !turn.content && !hasThinking && (
        <div
          className="rounded-md px-2.5 py-1.5"
          style={{
            background: "var(--rr-bg-surface)",
            color: "var(--rr-text-muted)",
            border: "1px solid var(--rr-border)",
            fontSize: "11px",
          }}
        >
          <span className="animate-pulse">
            {zh ? "思考中..." : "Thinking..."}
          </span>
        </div>
      )}
    </div>
  );
}
