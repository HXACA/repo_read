/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  runAgentLoop,
  runAgentLoopStream,
  extractUsage,
  type AgentLoopOptions,
  type AgentLoopEvent,
} from "../agent-loop.js";

// ─── Mock AI SDK ────────────────────────────────────────────────────────────

// Queue of mock responses. Each call to streamText shifts the next one.
let mockResponses: Array<{
  text: string;
  finishReason: string;
  usage: Record<string, unknown>;
  toolCalls: Array<{
    toolCallId: string;
    toolName: string;
    args: unknown;
  }>;
  fullStreamEvents?: Array<Record<string, unknown>>;
}> = [];

// Capture streamText call args for assertion
let lastStreamTextArgs: Record<string, unknown> | undefined;

vi.mock("ai", () => ({
  streamText: (args: Record<string, unknown>) => {
    lastStreamTextArgs = args;
    const response = mockResponses.shift()!;
    // Build fullStream from text-delta events or custom events
    // AI SDK 6 uses `delta` (not `text`) for text-delta/reasoning-delta
    const events = response.fullStreamEvents ?? [
      ...(response.text
        ? [{ type: "text-delta", delta: response.text }]
        : []),
      ...response.toolCalls.map((tc) => ({
        type: "tool-call",
        toolName: tc.toolName,
        toolCallId: tc.toolCallId,
        args: tc.args,
      })),
    ];

    return {
      text: Promise.resolve(response.text),
      finishReason: Promise.resolve(response.finishReason),
      usage: Promise.resolve(response.usage),
      toolCalls: Promise.resolve(response.toolCalls),
      toolResults: Promise.resolve([]),
      steps: Promise.resolve([]),
      fullStream: (async function* () {
        for (const event of events) {
          yield event;
        }
      })(),
    };
  },
}));

// Mock buildResponsesProviderOptions — default null (non-Responses), overrideable per test
vi.mock("../../utils/generate-via-stream.js", () => ({
  buildResponsesProviderOptions: vi.fn(() => null),
}));

import { buildResponsesProviderOptions } from "../../utils/generate-via-stream.js";
const mockBuildResponses = vi.mocked(buildResponsesProviderOptions);

// Mock withRetry to just call the function (no actual retries in tests)
vi.mock("../../utils/api-retry.js", () => ({
  withRetry: (fn: () => Promise<unknown>) => fn(),
}));

// ─── Helpers ────────────────────────────────────────────────────────────────

function makeModel(): any {
  return { provider: "test", modelId: "test-model" };
}

function makeOptions(overrides?: Partial<AgentLoopOptions>): AgentLoopOptions {
  return {
    model: makeModel(),
    system: "You are a test assistant.",
    tools: {} as any,
    maxSteps: 10,
    ...overrides,
  };
}

function makeUsage(
  promptTokens = 100,
  completionTokens = 50,
): Record<string, unknown> {
  return { promptTokens, completionTokens };
}

async function collectEvents(
  gen: AsyncGenerator<AgentLoopEvent>,
): Promise<AgentLoopEvent[]> {
  const events: AgentLoopEvent[] = [];
  for await (const event of gen) {
    events.push(event);
  }
  return events;
}

// ─── Tests ──────────────────────────────────────────────────────────────────

beforeEach(() => {
  mockResponses = [];
});

describe("extractUsage", () => {
  it("extracts camelCase AI SDK format", () => {
    const result = extractUsage({ promptTokens: 100, completionTokens: 50 });
    expect(result).toEqual({
      inputTokens: 100,
      outputTokens: 50,
      reasoningTokens: 0,
      cachedTokens: 0,
    });
  });

  it("extracts snake_case format with details", () => {
    const result = extractUsage({
      input_tokens: 200,
      output_tokens: 80,
      input_tokens_details: { cached_tokens: 150 },
      output_tokens_details: { reasoning_tokens: 30 },
    });
    expect(result).toEqual({
      inputTokens: 200,
      outputTokens: 80,
      reasoningTokens: 30,
      cachedTokens: 150,
    });
  });

  it("defaults to 0 when fields are missing", () => {
    const result = extractUsage({});
    expect(result).toEqual({
      inputTokens: 0,
      outputTokens: 0,
      reasoningTokens: 0,
      cachedTokens: 0,
    });
  });
});

describe("runAgentLoop", () => {
  it("returns text when model responds without tool calls (1 step)", async () => {
    mockResponses = [
      {
        text: "Hello, world!",
        finishReason: "stop",
        usage: makeUsage(100, 20),
        toolCalls: [],
      },
    ];

    const result = await runAgentLoop(makeOptions(), "Say hello");

    expect(result.text).toBe("Hello, world!");
    expect(result.steps).toHaveLength(1);
    expect(result.steps[0].finishReason).toBe("stop");
    expect(result.steps[0].stepIndex).toBe(0);
    expect(result.totalUsage.inputTokens).toBe(100);
    expect(result.totalUsage.outputTokens).toBe(20);
    // messages: user + assistant
    expect(result.messages).toHaveLength(2);
    expect(result.messages[0]).toEqual({
      role: "user",
      content: "Say hello",
    });
    expect(result.messages[1]).toEqual({
      role: "assistant",
      content: "Hello, world!",
    });
  });

  it("executes tool calls and continues loop (2 steps)", async () => {
    const mockTools = {
      readFile: {
        description: "Read a file",
        execute: vi.fn().mockResolvedValue("file content here"),
      },
    } as unknown as any;

    mockResponses = [
      {
        text: "",
        finishReason: "tool-calls",
        usage: makeUsage(100, 30),
        toolCalls: [
          {
            toolCallId: "call-1",
            toolName: "readFile",
            args: { path: "foo.ts" },
          },
        ],
      },
      {
        text: "The file contains: file content here",
        finishReason: "stop",
        usage: makeUsage(200, 40),
        toolCalls: [],
      },
    ];

    const result = await runAgentLoop(
      makeOptions({ tools: mockTools }),
      "Read foo.ts",
    );

    expect(result.text).toBe("The file contains: file content here");
    expect(result.steps).toHaveLength(2);
    expect(result.steps[0].toolCalls).toEqual([
      { name: "readFile", args: { path: "foo.ts" } },
    ]);
    expect(result.steps[1].toolCalls).toEqual([]);
    expect(result.totalUsage.inputTokens).toBe(300);
    expect(result.totalUsage.outputTokens).toBe(70);

    // Tool was actually executed (execute receives (args, options))
    expect(mockTools.readFile.execute).toHaveBeenCalledWith(
      { path: "foo.ts" },
      {},
    );

    // messages: user + assistant(tool-call) + tool(result) + assistant(text)
    expect(result.messages).toHaveLength(4);
    expect(result.messages[1].role).toBe("assistant");
    expect(result.messages[2].role).toBe("tool");
    expect(result.messages[3]).toEqual({
      role: "assistant",
      content: "The file contains: file content here",
    });
  });

  it("stops at maxSteps when tool calls continue every step", async () => {
    const mockTools = {
      search: {
        description: "Search",
        execute: vi.fn().mockResolvedValue("no results"),
      },
    } as unknown as any;

    // 3 steps, all with tool calls — should stop at maxSteps=3
    mockResponses = [
      {
        text: "",
        finishReason: "tool-calls",
        usage: makeUsage(50, 10),
        toolCalls: [
          { toolCallId: "c1", toolName: "search", args: { q: "a" } },
        ],
      },
      {
        text: "",
        finishReason: "tool-calls",
        usage: makeUsage(50, 10),
        toolCalls: [
          { toolCallId: "c2", toolName: "search", args: { q: "b" } },
        ],
      },
      {
        text: "",
        finishReason: "tool-calls",
        usage: makeUsage(50, 10),
        toolCalls: [
          { toolCallId: "c3", toolName: "search", args: { q: "c" } },
        ],
      },
    ];

    const result = await runAgentLoop(
      makeOptions({ tools: mockTools, maxSteps: 3 }),
      "Search everything",
    );

    // Should have run exactly 3 steps
    expect(result.steps).toHaveLength(3);
    expect(mockTools.search.execute).toHaveBeenCalledTimes(3);
    expect(result.totalUsage.inputTokens).toBe(150);
    expect(result.totalUsage.outputTokens).toBe(30);
  });

  it("calls onStep callback with correct stepIndex and usage", async () => {
    const onStep = vi.fn();

    mockResponses = [
      {
        text: "Step 0 text",
        finishReason: "stop",
        usage: makeUsage(120, 35),
        toolCalls: [],
      },
    ];

    await runAgentLoop(makeOptions({ onStep }), "test");

    expect(onStep).toHaveBeenCalledTimes(1);
    expect(onStep).toHaveBeenCalledWith(
      expect.objectContaining({
        stepIndex: 0,
        inputTokens: 120,
        outputTokens: 35,
        finishReason: "stop",
      }),
    );
  });

  it("catches tool execution errors and returns them as error strings", async () => {
    const mockTools = {
      failingTool: {
        description: "A tool that fails",
        execute: vi.fn().mockRejectedValue(new Error("disk is full")),
      },
    } as unknown as any;

    mockResponses = [
      {
        text: "",
        finishReason: "tool-calls",
        usage: makeUsage(50, 10),
        toolCalls: [
          {
            toolCallId: "c1",
            toolName: "failingTool",
            args: {},
          },
        ],
      },
      {
        text: "I see the tool failed.",
        finishReason: "stop",
        usage: makeUsage(80, 20),
        toolCalls: [],
      },
    ];

    const result = await runAgentLoop(
      makeOptions({ tools: mockTools }),
      "Do something",
    );

    // Should not have thrown — error is in the tool result message
    expect(result.text).toBe("I see the tool failed.");
    expect(result.steps).toHaveLength(2);

    // The tool result message should contain the error
    const toolMsg = result.messages.find((m) => m.role === "tool");
    expect(toolMsg).toBeDefined();
    const toolContent = (toolMsg as any).content[0];
    expect(toolContent.output).toEqual({ type: "text", value: "Error: disk is full" });
  });
});

describe("runAgentLoopStream", () => {
  it("yields text-delta events and done event", async () => {
    mockResponses = [
      {
        text: "Hello stream!",
        finishReason: "stop",
        usage: makeUsage(80, 15),
        toolCalls: [],
        fullStreamEvents: [
          { type: "text-delta", delta: "Hello " },
          { type: "text-delta", delta: "stream!" },
        ],
      },
    ];

    const events = await collectEvents(
      runAgentLoopStream(makeOptions(), "Stream test"),
    );

    const textDeltas = events.filter((e) => e.type === "text-delta");
    expect(textDeltas).toHaveLength(2);
    expect((textDeltas[0] as any).text).toBe("Hello ");
    expect((textDeltas[1] as any).text).toBe("stream!");

    const stepDone = events.find((e) => e.type === "step-done");
    expect(stepDone).toBeDefined();

    const done = events.find((e) => e.type === "done");
    expect(done).toBeDefined();
    expect((done as any).result.text).toBe("Hello stream!");
  });

  it("yields tool-call and tool-result events during multi-step", async () => {
    const mockTools = {
      grep: {
        description: "Search files",
        execute: vi.fn().mockResolvedValue("found: line 42"),
      },
    } as unknown as any;

    mockResponses = [
      {
        text: "",
        finishReason: "tool-calls",
        usage: makeUsage(60, 10),
        toolCalls: [
          { toolCallId: "tc1", toolName: "grep", args: { pattern: "foo" } },
        ],
        fullStreamEvents: [
          {
            type: "tool-call",
            toolName: "grep",
            toolCallId: "tc1",
            args: { pattern: "foo" },
          },
        ],
      },
      {
        text: "Found it on line 42.",
        finishReason: "stop",
        usage: makeUsage(100, 20),
        toolCalls: [],
        fullStreamEvents: [
          { type: "text-delta", delta: "Found it on line 42." },
        ],
      },
    ];

    const events = await collectEvents(
      runAgentLoopStream(makeOptions({ tools: mockTools }), "Find foo"),
    );

    const toolCall = events.find((e) => e.type === "tool-call");
    expect(toolCall).toBeDefined();
    expect((toolCall as any).name).toBe("grep");

    const toolResult = events.find((e) => e.type === "tool-result");
    expect(toolResult).toBeDefined();
    expect((toolResult as any).name).toBe("grep");
    expect((toolResult as any).output).toBe("found: line 42");

    const stepDones = events.filter((e) => e.type === "step-done");
    expect(stepDones).toHaveLength(2);

    const done = events.find((e) => e.type === "done") as any;
    expect(done.result.steps).toHaveLength(2);
    expect(done.result.totalUsage.inputTokens).toBe(160);
  });
});

describe("session_id header injection", () => {
  beforeEach(() => {
    lastStreamTextArgs = undefined;
  });

  afterEach(() => {
    mockBuildResponses.mockReturnValue(null);
  });

  it("injects session_id header when model is openai.responses and cacheKey is set", async () => {
    mockBuildResponses.mockReturnValue({
      providerOptions: { openai: { store: false, promptCacheKey: "job-1" } },
      stripSystem: false,
      stripMaxOutputTokens: false,
    });

    mockResponses = [{ text: "ok", finishReason: "stop", usage: makeUsage(10, 5), toolCalls: [] }];

    await runAgentLoop(
      { ...makeOptions(), providerCallOptions: { cacheKey: "job-1" } },
      "test",
    );

    expect(lastStreamTextArgs?.headers).toEqual({ session_id: "job-1" });
  });

  it("does NOT inject session_id header for non-Responses models even with cacheKey", async () => {
    mockBuildResponses.mockReturnValue(null);

    mockResponses = [{ text: "ok", finishReason: "stop", usage: makeUsage(10, 5), toolCalls: [] }];

    await runAgentLoop(
      { ...makeOptions(), providerCallOptions: { cacheKey: "job-1" } },
      "test",
    );

    expect(lastStreamTextArgs?.headers).toBeUndefined();
  });

  it("does NOT inject session_id header when cacheKey is not set", async () => {
    mockBuildResponses.mockReturnValue({
      providerOptions: { openai: { store: false } },
      stripSystem: false,
      stripMaxOutputTokens: false,
    });

    mockResponses = [{ text: "ok", finishReason: "stop", usage: makeUsage(10, 5), toolCalls: [] }];

    await runAgentLoop(makeOptions(), "test");

    expect(lastStreamTextArgs?.headers).toBeUndefined();
  });
});
