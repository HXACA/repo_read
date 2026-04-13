/**
 * Shared AI SDK mock for tests.
 *
 * Provides both `generateText` (for tests that assert on it directly)
 * and `streamText` (used by `runAgentLoop` internally). The `streamText`
 * mock delegates to `generateText` so existing test setups that configure
 * `generateText.mockResolvedValue(...)` automatically work with the
 * agent loop too.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { vi } from "vitest";

const generateText = vi.fn();

/**
 * Creates a streamText mock that wraps generateText results in the
 * async getter pattern that streamText returns.
 */
function createStreamTextMock() {
  return vi.fn((...args: unknown[]) => {
    // Call generateText with the same args and wrap the result
    const promise = generateText(...args);
    return {
      text: promise.then((r: any) => r?.text ?? ""),
      finishReason: promise.then((r: any) => r?.finishReason ?? "stop"),
      usage: promise.then((r: any) => r?.usage ?? {}),
      toolCalls: promise.then((r: any) => r?.toolCalls ?? []),
      toolResults: promise.then((r: any) => r?.toolResults ?? []),
      steps: promise.then((r: any) => r?.steps ?? []),
      response: promise.then((r: any) => r?.response ?? {}),
      // For fullStream consumers (ask-stream.ts)
      fullStream: (async function* () {
        const r = await promise;
        if (r?.text) yield { type: "text-delta", textDelta: r.text };
      })(),
    };
  });
}

export const streamText = createStreamTextMock();

export function createAiMock() {
  return {
    generateText,
    streamText,
    jsonSchema: vi.fn((s: unknown) => s),
    stepCountIs: vi.fn(() => () => false),
    tool: vi.fn((def: unknown) => def),
  };
}
