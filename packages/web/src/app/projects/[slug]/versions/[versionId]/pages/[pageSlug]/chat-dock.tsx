"use client";

import { useState, useRef, useEffect } from "react";

type Citation = {
  kind: string;
  target: string;
  locator?: string;
  note?: string;
};

type Turn = {
  role: "user" | "assistant";
  content: string;
  citations: Citation[];
};

export function ChatDock({
  slug,
  versionId,
  pageSlug,
}: {
  slug: string;
  versionId: string;
  pageSlug: string;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [sessionId, setSessionId] = useState<string | undefined>();
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [turns]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || loading) return;

    const question = input.trim();
    setInput("");
    setTurns((prev) => [...prev, { role: "user", content: question, citations: [] }]);
    setLoading(true);

    try {
      const res = await fetch(`/api/projects/${slug}/versions/${versionId}/ask`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question, currentPageSlug: pageSlug, sessionId }),
      });

      const data = await res.json();

      if (data.sessionId) setSessionId(data.sessionId);

      setTurns((prev) => [
        ...prev,
        { role: "assistant", content: data.answer ?? data.error, citations: data.citations ?? [] },
      ]);
    } catch (err) {
      setTurns((prev) => [
        ...prev,
        { role: "assistant", content: `Error: ${(err as Error).message}`, citations: [] },
      ]);
    } finally {
      setLoading(false);
    }
  };

  if (!isOpen) {
    return (
      <button
        onClick={() => setIsOpen(true)}
        className="fixed bottom-6 right-6 z-50 rounded-full bg-blue-600 p-3 text-white shadow-lg hover:bg-blue-700"
        title="Ask about this page"
      >
        <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" />
        </svg>
      </button>
    );
  }

  return (
    <div className="fixed bottom-0 right-0 z-50 flex h-[500px] w-[400px] flex-col rounded-tl-xl border border-gray-200 bg-white shadow-2xl dark:border-gray-700 dark:bg-gray-900">
      <div className="flex items-center justify-between border-b border-gray-200 px-4 py-3 dark:border-gray-700">
        <h3 className="text-sm font-semibold">Ask about this page</h3>
        <button onClick={() => setIsOpen(false)} className="text-gray-400 hover:text-gray-600">
          &times;
        </button>
      </div>

      <div className="flex-1 space-y-3 overflow-y-auto p-4">
        {turns.map((turn, i) => (
          <div key={i} className={`text-sm ${turn.role === "user" ? "text-right" : "text-left"}`}>
            <div
              className={`inline-block max-w-[85%] rounded-lg px-3 py-2 ${
                turn.role === "user"
                  ? "bg-blue-600 text-white"
                  : "bg-gray-100 text-gray-900 dark:bg-gray-800 dark:text-gray-100"
              }`}
            >
              {turn.content}
            </div>
            {turn.citations.length > 0 && (
              <div className="mt-1 text-xs text-gray-400">
                {turn.citations.map((c, j) => (
                  <span key={j} className="mr-2">
                    [{c.kind}:{c.target}]
                  </span>
                ))}
              </div>
            )}
          </div>
        ))}
        {loading && (
          <div className="text-sm text-gray-400">Thinking...</div>
        )}
        <div ref={bottomRef} />
      </div>

      <form onSubmit={handleSubmit} className="border-t border-gray-200 p-3 dark:border-gray-700">
        <div className="flex gap-2">
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Ask a question..."
            className="flex-1 rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none dark:border-gray-600 dark:bg-gray-800"
            disabled={loading}
          />
          <button
            type="submit"
            disabled={loading || !input.trim()}
            className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
          >
            Send
          </button>
        </div>
      </form>
    </div>
  );
}
