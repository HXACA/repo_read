import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";
import { AskStreamService, type AskStreamEvent } from "../ask-stream.js";
import { StorageAdapter } from "../../storage/storage-adapter.js";
import { getQualityProfile } from "../../config/quality-profile.js";
import type { WikiJson, PageMeta } from "../../types/generation.js";

// Async generator that yields a single text-delta then completes. Mirrors
// the shape of `streamText(...).fullStream` just enough for our code path.
async function* fakeFullStream(text: string) {
  yield { type: "text-delta", text } as unknown as {
    type: "text-delta";
    text: string;
  };
}

vi.mock("ai", () => ({
  streamText: vi.fn(),
  generateText: vi.fn(),
  jsonSchema: vi.fn((s: unknown) => s),
  stepCountIs: vi.fn((n: number) => ({ __steps: n })),
}));

const answerText = `Short answer here.

\`\`\`json
{ "citations": [] }
\`\`\``;

describe("AskStreamService route dispatch", () => {
  let tmpDir: string;
  let storage: StorageAdapter;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "reporead-ask-stream-"));
    storage = new StorageAdapter(tmpDir);
    await storage.initialize();
    vi.clearAllMocks();
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  async function primeProject() {
    // Write a minimal wiki.json and page so classifyRoute has something
    // to work with (page-plus-retrieval requires a pageMeta to fire).
    const wiki: WikiJson = {
      summary: "Test",
      reading_order: [
        {
          slug: "overview",
          title: "Overview",
          rationale: "intro",
          covered_files: ["README.md"],
        },
      ],
    };
    await storage.writeJson(
      storage.paths.versionWikiJson("proj", "v1"),
      wiki,
    );
    const meta: PageMeta = {
      slug: "overview",
      title: "Overview",
      order: 1,
      sectionId: "overview",
      coveredFiles: ["README.md"],
      relatedPages: [],
      generatedAt: new Date().toISOString(),
      commitHash: "abc",
      citationFile: "citations/overview.citations.json",
      summary: "overview summary",
      reviewStatus: "accepted",
      reviewSummary: "ok",
      reviewDigest: "{}",
      status: "validated",
      validation: {
        structurePassed: true,
        mermaidPassed: true,
        citationsPassed: true,
        linksPassed: true,
        summary: "passed",
      },
    };
    await storage.writeJson(
      storage.paths.versionPageMeta("proj", "v1", "overview"),
      meta,
    );
    const pagePath = storage.paths.versionPageMd("proj", "v1", "overview");
    await fs.mkdir(path.dirname(pagePath), { recursive: true });
    await fs.writeFile(pagePath, "# Overview\n\nPage content.", "utf-8");
  }

  async function collect(
    iter: AsyncGenerator<AskStreamEvent>,
  ): Promise<AskStreamEvent[]> {
    const out: AskStreamEvent[] = [];
    for await (const e of iter) out.push(e);
    return out;
  }

  it("page-first route: no tools, tiny budget", async () => {
    await primeProject();
    const { streamText, stepCountIs } = await import("ai");
    const mockStream = vi.mocked(streamText);
    mockStream.mockReturnValueOnce({
      fullStream: fakeFullStream(answerText),
    } as never);

    const service = new AskStreamService({
      model: {} as never,
      storage,
      repoRoot: tmpDir,
      qualityProfile: getQualityProfile("quality"),
    });

    // Phrase matches the "this page" heuristic in classifyRoute → page-first
    const events = await collect(
      service.ask("proj", "v1", "what does this page cover?", {
        currentPageSlug: "overview",
      }),
    );

    // Session event should report route=page-first
    const session = events.find((e) => e.type === "session") as Extract<
      AskStreamEvent,
      { type: "session" }
    >;
    expect(session.route).toBe("page-first");

    // streamText was called with an empty tools object
    expect(mockStream).toHaveBeenCalledTimes(1);
    const callArgs = mockStream.mock.calls[0][0] as {
      tools: Record<string, unknown>;
    };
    expect(Object.keys(callArgs.tools)).toHaveLength(0);

    // stepCountIs received the tiny budget (2) for page-first, not the
    // quality profile's askMaxSteps (15)
    const stepCalls = vi.mocked(stepCountIs).mock.calls;
    expect(stepCalls[stepCalls.length - 1][0]).toBe(2);
  });

  it("page-plus-retrieval route: full tools, profile budget", async () => {
    await primeProject();
    const { streamText, stepCountIs } = await import("ai");
    const mockStream = vi.mocked(streamText);
    mockStream.mockReturnValueOnce({
      fullStream: fakeFullStream(answerText),
    } as never);

    const service = new AskStreamService({
      model: {} as never,
      storage,
      repoRoot: tmpDir,
      qualityProfile: getQualityProfile("balanced"),
    });

    // A neutral question on a page — no page-specific heuristics fire, no
    // research heuristics fire, current page slug is set → default to
    // page-plus-retrieval.
    const events = await collect(
      service.ask("proj", "v1", "what is the role of README?", {
        currentPageSlug: "overview",
      }),
    );

    const session = events.find((e) => e.type === "session") as Extract<
      AskStreamEvent,
      { type: "session" }
    >;
    expect(session.route).toBe("page-plus-retrieval");

    expect(mockStream).toHaveBeenCalledTimes(1);
    const callArgs = mockStream.mock.calls[0][0] as {
      tools: Record<string, unknown>;
    };
    // Catalog tools should be present (grep/find/read etc.)
    expect(Object.keys(callArgs.tools).length).toBeGreaterThan(0);

    // Should use the balanced preset's askMaxSteps (10)
    const stepCalls = vi.mocked(stepCountIs).mock.calls;
    expect(stepCalls[stepCalls.length - 1][0]).toBe(10);
  });

  it("research route: delegates to ResearchService, no streamText", async () => {
    await primeProject();
    const { streamText, generateText } = await import("ai");
    const mockStream = vi.mocked(streamText);
    const mockGenerate = vi.mocked(generateText);

    // ResearchService uses generateText for planner, executor (×N), and
    // synthesis. Three sub-questions + 1 planner + 1 synthesis = up to 5
    // calls. We mock enough to drive the pipeline to completion.
    mockGenerate.mockResolvedValue({
      text: JSON.stringify({
        topic: "architecture",
        subQuestions: ["how does X work"],
        scope: "architecture",
        findings: ["finding 1"],
        citations: [
          { kind: "file", target: "src/main.ts", locator: "1-10", note: "entry" },
        ],
        openQuestions: [],
        facts: [
          {
            statement: "X uses a state machine",
            citations: [
              { kind: "file", target: "src/main.ts", locator: "1-10" },
            ],
          },
        ],
        inferences: [],
        unconfirmed: [],
        summary: "Architecture uses a state machine pattern.",
      }),
      usage: { inputTokens: 100, outputTokens: 50 },
    } as never);

    const service = new AskStreamService({
      model: {} as never,
      storage,
      repoRoot: tmpDir,
      qualityProfile: getQualityProfile("budget"),
    });

    // Phrase that triggers research route
    const events = await collect(
      service.ask("proj", "v1", "explain the architecture of the system"),
    );

    const session = events.find((e) => e.type === "session") as Extract<
      AskStreamEvent,
      { type: "session" }
    >;
    expect(session.route).toBe("research");

    // streamText should NOT have been called — research route uses
    // generateText (via ResearchService) exclusively.
    expect(mockStream).not.toHaveBeenCalled();
    expect(mockGenerate).toHaveBeenCalled();

    // Output should contain the synthesis summary
    const textDeltas = events.filter((e) => e.type === "text-delta") as Array<
      Extract<AskStreamEvent, { type: "text-delta" }>
    >;
    const combined = textDeltas.map((e) => e.text).join("");
    expect(combined).toContain("state machine");

    // Should yield a citations event with the facts' citations
    const citationsEvent = events.find((e) => e.type === "citations") as
      | Extract<AskStreamEvent, { type: "citations" }>
      | undefined;
    expect(citationsEvent).toBeDefined();
    expect(citationsEvent!.citations.length).toBeGreaterThan(0);
    expect(citationsEvent!.citations[0].target).toBe("src/main.ts");

    // Should end with done
    expect(events[events.length - 1].type).toBe("done");
  });
});
