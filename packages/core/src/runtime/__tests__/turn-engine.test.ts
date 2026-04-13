import { describe, it, expect, vi } from "vitest";
import { TurnEngineAdapter } from "../turn-engine.js";
import type { TurnRequest } from "../turn-types.js";
import type { AgentLoopResult, StepInfo } from "../../agent/agent-loop.js";
import type { LanguageModel, ToolSet } from "ai";

// ─── Helpers ────────────────────────────────────────────────────────────────

function makeStep(overrides: Partial<StepInfo> = {}): StepInfo {
  return {
    stepIndex: 0,
    inputTokens: 10,
    outputTokens: 20,
    reasoningTokens: 5,
    cachedTokens: 2,
    toolCalls: [],
    finishReason: "stop",
    ...overrides,
  };
}

function makeAgentLoopResult(overrides: Partial<AgentLoopResult> = {}): AgentLoopResult {
  return {
    text: "hello world",
    messages: [{ role: "user", content: "test prompt" }],
    totalUsage: {
      inputTokens: 100,
      outputTokens: 200,
      reasoningTokens: 50,
      cachedTokens: 25,
    },
    steps: [makeStep()],
    ...overrides,
  };
}

function makeRequest(overrides: Partial<TurnRequest> = {}): TurnRequest {
  return {
    purpose: "draft",
    model: {} as LanguageModel,
    systemPrompt: "You are a helpful assistant.",
    userPrompt: "Write a summary.",
    tools: {} as ToolSet,
    policy: {
      maxSteps: 5,
    },
    ...overrides,
  };
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe("TurnEngineAdapter", () => {
  describe("run() — delegation and result normalization", () => {
    it("delegates to invokeTurn with correct options and normalizes text", async () => {
      const loopResult = makeAgentLoopResult({ text: "normalized text" });
      const invokeTurn = vi.fn().mockResolvedValue(loopResult);

      const adapter = new TurnEngineAdapter({ invokeTurn });
      const request = makeRequest();
      const result = await adapter.run(request);

      expect(invokeTurn).toHaveBeenCalledOnce();
      expect(result.text).toBe("normalized text");
    });

    it("normalizes usage from totalUsage", async () => {
      const loopResult = makeAgentLoopResult({
        totalUsage: { inputTokens: 111, outputTokens: 222, reasoningTokens: 33, cachedTokens: 44 },
      });
      const invokeTurn = vi.fn().mockResolvedValue(loopResult);
      const adapter = new TurnEngineAdapter({ invokeTurn });

      const result = await adapter.run(makeRequest());

      expect(result.usage).toEqual({
        inputTokens: 111,
        outputTokens: 222,
        reasoningTokens: 33,
        cachedTokens: 44,
      });
    });

    it("extracts finishReason from last step", async () => {
      const steps = [
        makeStep({ stepIndex: 0, finishReason: "tool-calls" }),
        makeStep({ stepIndex: 1, finishReason: "stop" }),
      ];
      const loopResult = makeAgentLoopResult({ steps });
      const invokeTurn = vi.fn().mockResolvedValue(loopResult);
      const adapter = new TurnEngineAdapter({ invokeTurn });

      const result = await adapter.run(makeRequest());

      expect(result.finishReason).toBe("stop");
    });

    it("returns 'unknown' finishReason when steps array is empty", async () => {
      const loopResult = makeAgentLoopResult({ steps: [] });
      const invokeTurn = vi.fn().mockResolvedValue(loopResult);
      const adapter = new TurnEngineAdapter({ invokeTurn });

      const result = await adapter.run(makeRequest());

      expect(result.finishReason).toBe("unknown");
    });

    it("passes through messages and steps unchanged", async () => {
      const steps = [makeStep({ stepIndex: 0 })];
      const messages = [{ role: "user" as const, content: "hello" }];
      const loopResult = makeAgentLoopResult({ steps, messages });
      const invokeTurn = vi.fn().mockResolvedValue(loopResult);
      const adapter = new TurnEngineAdapter({ invokeTurn });

      const result = await adapter.run(makeRequest());

      expect(result.steps).toBe(steps);
      expect(result.messages).toBe(messages);
    });
  });

  describe("run() — invokeTurn call shape", () => {
    it("passes model, system, tools, maxSteps to invokeTurn", async () => {
      const invokeTurn = vi.fn().mockResolvedValue(makeAgentLoopResult());
      const adapter = new TurnEngineAdapter({ invokeTurn });

      const model = { id: "test-model" } as unknown as LanguageModel;
      const tools = { myTool: {} } as unknown as ToolSet;
      const request = makeRequest({
        model,
        systemPrompt: "Be helpful.",
        tools,
        policy: {
          maxSteps: 10,
        },
      });

      await adapter.run(request);

      const [calledOptions, calledPrompt] = invokeTurn.mock.calls[0] as [unknown, unknown];
      expect(calledOptions).toMatchObject({
        model,
        system: "Be helpful.",
        tools,
        maxSteps: 10,
      });
      expect(calledPrompt).toBe(request.userPrompt);
    });

    it("passes maxOutputTokens when set in policy", async () => {
      const invokeTurn = vi.fn().mockResolvedValue(makeAgentLoopResult());
      const adapter = new TurnEngineAdapter({ invokeTurn });

      const request = makeRequest({
        policy: {
          maxSteps: 5,
          maxOutputTokens: 4096,
        },
      });

      await adapter.run(request);

      const [calledOptions] = invokeTurn.mock.calls[0] as [Record<string, unknown>, unknown];
      expect(calledOptions.maxOutputTokens).toBe(4096);
    });

    it("omits maxOutputTokens when not set in policy", async () => {
      const invokeTurn = vi.fn().mockResolvedValue(makeAgentLoopResult());
      const adapter = new TurnEngineAdapter({ invokeTurn });

      await adapter.run(makeRequest()); // policy has no maxOutputTokens

      const [calledOptions] = invokeTurn.mock.calls[0] as [Record<string, unknown>, unknown];
      expect(calledOptions.maxOutputTokens).toBeUndefined();
    });

    it("passes onStep callback through to invokeTurn", async () => {
      const invokeTurn = vi.fn().mockResolvedValue(makeAgentLoopResult());
      const adapter = new TurnEngineAdapter({ invokeTurn });
      const onStep = vi.fn();

      await adapter.run(makeRequest({ onStep }));

      const [calledOptions] = invokeTurn.mock.calls[0] as [Record<string, unknown>, unknown];
      expect(calledOptions.onStep).toBe(onStep);
    });

    it("passes undefined onStep when not provided", async () => {
      const invokeTurn = vi.fn().mockResolvedValue(makeAgentLoopResult());
      const adapter = new TurnEngineAdapter({ invokeTurn });

      const request = makeRequest();
      delete request.onStep;
      await adapter.run(request);

      const [calledOptions] = invokeTurn.mock.calls[0] as [Record<string, unknown>, unknown];
      expect(calledOptions.onStep).toBeUndefined();
    });
  });

  describe("run() — providerCallOptions pass-through", () => {
    it("passes providerCallOptions as undefined when no providerOptions in policy", async () => {
      const invokeTurn = vi.fn().mockResolvedValue(makeAgentLoopResult());
      const adapter = new TurnEngineAdapter({ invokeTurn });

      await adapter.run(makeRequest()); // no providerOptions in policy

      const [calledOptions] = invokeTurn.mock.calls[0] as [Record<string, unknown>, unknown];
      expect(calledOptions.providerCallOptions).toBeUndefined();
    });

    it("passes providerCallOptions with cacheKey only", async () => {
      const invokeTurn = vi.fn().mockResolvedValue(makeAgentLoopResult());
      const adapter = new TurnEngineAdapter({ invokeTurn });

      const request = makeRequest({
        policy: {
          maxSteps: 5,
          providerOptions: { cacheKey: "only-cache-key" },
        },
      });

      await adapter.run(request);

      const [calledOptions] = invokeTurn.mock.calls[0] as [Record<string, unknown>, unknown];
      expect(calledOptions.providerCallOptions).toEqual({ cacheKey: "only-cache-key" });
    });

    it("passes providerCallOptions with reasoning", async () => {
      const invokeTurn = vi.fn().mockResolvedValue(makeAgentLoopResult());
      const adapter = new TurnEngineAdapter({ invokeTurn });

      const request = makeRequest({
        policy: {
          maxSteps: 5,
          providerOptions: {
            reasoning: { effort: "high", summary: "auto" },
          },
        },
      });

      await adapter.run(request);

      const [calledOptions] = invokeTurn.mock.calls[0] as [Record<string, unknown>, unknown];
      expect(calledOptions.providerCallOptions).toEqual({
        reasoning: { effort: "high", summary: "auto" },
      });
    });

    it("passes providerCallOptions with serviceTier", async () => {
      const invokeTurn = vi.fn().mockResolvedValue(makeAgentLoopResult());
      const adapter = new TurnEngineAdapter({ invokeTurn });

      const request = makeRequest({
        policy: {
          maxSteps: 5,
          providerOptions: { serviceTier: "flex" },
        },
      });

      await adapter.run(request);

      const [calledOptions] = invokeTurn.mock.calls[0] as [Record<string, unknown>, unknown];
      expect(calledOptions.providerCallOptions).toEqual({ serviceTier: "flex" });
    });

    it("passes providerCallOptions with all fields when both reasoning and serviceTier provided", async () => {
      const invokeTurn = vi.fn().mockResolvedValue(makeAgentLoopResult());
      const adapter = new TurnEngineAdapter({ invokeTurn });

      const request = makeRequest({
        policy: {
          maxSteps: 5,
          providerOptions: {
            cacheKey: "test-key",
            reasoning: { effort: "medium", summary: "detailed" },
            serviceTier: "fast",
          },
        },
      });

      await adapter.run(request);

      const [calledOptions] = invokeTurn.mock.calls[0] as [Record<string, unknown>, unknown];
      expect(calledOptions.providerCallOptions).toEqual({
        cacheKey: "test-key",
        reasoning: { effort: "medium", summary: "detailed" },
        serviceTier: "fast",
      });
    });
  });

  describe("stream() — event pass-through", () => {
    it("yields text-delta events from invokeStream", async () => {
      async function* fakeStream(): AsyncGenerator<import("../../agent/agent-loop.js").AgentLoopEvent> {
        yield { type: "text-delta", text: "hello " };
        yield { type: "text-delta", text: "world" };
        yield { type: "done", result: makeAgentLoopResult({ text: "hello world" }) };
      }
      const invokeStream = vi.fn().mockReturnValue(fakeStream());
      const adapter = new TurnEngineAdapter({ invokeStream });

      const events: Array<import("../../agent/agent-loop.js").AgentLoopEvent> = [];
      for await (const event of adapter.stream(makeRequest())) {
        events.push(event);
      }

      expect(events.filter((e) => e.type === "text-delta")).toHaveLength(2);
      expect(events[0]).toEqual({ type: "text-delta", text: "hello " });
      expect(events[1]).toEqual({ type: "text-delta", text: "world" });
    });

    it("passes providerCallOptions through in stream path", async () => {
      async function* fakeStream(): AsyncGenerator<import("../../agent/agent-loop.js").AgentLoopEvent> {
        yield { type: "done", result: makeAgentLoopResult() };
      }
      const invokeStream = vi.fn().mockReturnValue(fakeStream());
      const adapter = new TurnEngineAdapter({ invokeStream });

      const request = makeRequest({
        policy: {
          maxSteps: 5,
          providerOptions: { cacheKey: "stream-key" },
        },
      });

      // Consume the generator
      // eslint-disable-next-line @typescript-eslint/no-unused-vars -- draining
      for await (const _ of adapter.stream(request)) { /* drain */ }

      const [calledOptions] = invokeStream.mock.calls[0] as [Record<string, unknown>, unknown];
      expect(calledOptions.providerCallOptions).toEqual({ cacheKey: "stream-key" });
    });

    it("yields done event containing the result", async () => {
      const loopResult = makeAgentLoopResult({ text: "final answer" });
      async function* fakeStream(): AsyncGenerator<import("../../agent/agent-loop.js").AgentLoopEvent> {
        yield { type: "text-delta", text: "final answer" };
        yield { type: "done", result: loopResult };
      }
      const invokeStream = vi.fn().mockReturnValue(fakeStream());
      const adapter = new TurnEngineAdapter({ invokeStream });

      const events: Array<import("../../agent/agent-loop.js").AgentLoopEvent> = [];
      for await (const event of adapter.stream(makeRequest())) {
        events.push(event);
      }

      const doneEvent = events.find((e) => e.type === "done");
      expect(doneEvent).toBeDefined();
      expect(doneEvent!.type).toBe("done");
      expect((doneEvent as { type: "done"; result: AgentLoopResult }).result.text).toBe("final answer");
    });
  });

  describe("constructor — default dependency injection", () => {
    it("constructs without options (uses real defaults)", () => {
      // Just verifies no error is thrown when constructing with defaults
      expect(() => new TurnEngineAdapter()).not.toThrow();
    });
  });
});
