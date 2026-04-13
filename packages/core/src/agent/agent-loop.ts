/**
 * Self-managed agent loop — replaces AI SDK's built-in stepCountIs loop.
 *
 * Provides two entry points:
 * - `runAgentLoop()` for pipeline use (non-streaming, returns final result)
 * - `runAgentLoopStream()` for Ask (yields events as they stream)
 *
 * Both share the same core loop: call streamText one step at a time,
 * execute any tool calls, append messages, and repeat.
 */

import { streamText } from "ai";
import type { LanguageModel, ToolSet } from "ai";
import { withRetry } from "../utils/api-retry.js";
import { buildResponsesProviderOptions, type ProviderCallOptions } from "../utils/generate-via-stream.js";

// ─── Types ──────────────────────────────────────────────────────────────────

export type StepInfo = {
  stepIndex: number;
  inputTokens: number;
  outputTokens: number;
  reasoningTokens: number;
  cachedTokens: number;
  toolCalls: Array<{ name: string; args: unknown }>;
  finishReason: string;
};

export type AgentLoopOptions = {
  model: LanguageModel;
  system: string;
  tools: ToolSet;
  maxSteps: number;
  maxOutputTokens?: number; // passed through to streamText when set
  maxInputTokens?: number;  // reserved for P2 compression, not used yet
  providerCallOptions?: ProviderCallOptions;
  onStep?: (step: StepInfo) => void;
};

export type AgentLoopResult = {
  text: string;
  messages: Message[];
  totalUsage: {
    inputTokens: number;
    outputTokens: number;
    reasoningTokens: number;
    cachedTokens: number;
  };
  steps: StepInfo[];
};

export type Message =
  | { role: "user"; content: string }
  | { role: "assistant"; content: string | AssistantContentPart[] }
  | { role: "tool"; content: ToolResultPart[] };

type AssistantContentPart =
  | { type: "text"; text: string }
  | { type: "tool-call"; toolCallId: string; toolName: string; input: unknown };

type ToolResultPart = {
  type: "tool-result";
  toolCallId: string;
  toolName: string;
  output: { type: "text"; value: string };
};

export type AgentLoopEvent =
  | { type: "text-delta"; text: string }
  | { type: "reasoning-delta"; text: string }
  | { type: "tool-call"; name: string; args: unknown }
  | { type: "tool-result"; name: string; output: string }
  | { type: "step-done"; step: StepInfo }
  | { type: "done"; result: AgentLoopResult };

// ─── Usage extraction ───────────────────────────────────────────────────────

/**
 * Normalise usage from AI SDK's varying provider formats into our
 * standard 4-field shape.
 *
 * AI SDK typically returns `{ promptTokens, completionTokens }` but
 * some providers (OpenAI) return snake_case with nested detail objects.
 */
export function extractUsage(usage: Record<string, unknown>): {
  inputTokens: number;
  outputTokens: number;
  reasoningTokens: number;
  cachedTokens: number;
} {
  // camelCase path (AI SDK standard)
  const inputTokens =
    (usage.promptTokens as number | undefined) ??
    (usage.input_tokens as number | undefined) ??
    0;

  const outputTokens =
    (usage.completionTokens as number | undefined) ??
    (usage.output_tokens as number | undefined) ??
    0;

  // Reasoning tokens — nested inside output_tokens_details or providerMetadata
  const outputDetails = usage.output_tokens_details as
    | Record<string, unknown>
    | undefined;
  const reasoningTokens =
    (outputDetails?.reasoning_tokens as number | undefined) ??
    0;

  // Cached tokens — nested inside input_tokens_details or providerMetadata
  const inputDetails = usage.input_tokens_details as
    | Record<string, unknown>
    | undefined;
  const cachedTokens =
    (inputDetails?.cached_tokens as number | undefined) ??
    (usage.cache_read_input_tokens as number | undefined) ?? // Anthropic format
    0;

  return { inputTokens, outputTokens, reasoningTokens, cachedTokens };
}

// ─── Internal: build streamText params for one step ─────────────────────────

/**
 * Normalised tool call shape used internally. AI SDK uses `input` for the
 * parsed arguments, but downstream code (and our StepInfo) calls it `args`.
 */
type ToolCallRecord = {
  toolCallId: string;
  toolName: string;
  args: unknown;
};

/** Map an AI SDK tool call (which uses `input`) to our internal shape. */
function normaliseToolCalls(raw: unknown[]): ToolCallRecord[] {
  return (raw as Array<Record<string, unknown>>).map((tc) => ({
    toolCallId: tc.toolCallId as string,
    toolName: tc.toolName as string,
    args: tc.input ?? tc.args,
  }));
}

function buildStreamParams(
  model: LanguageModel,
  system: string,
  messages: Message[],
  tools: ToolSet,
  maxOutputTokens?: number,
  providerCallOptions?: ProviderCallOptions,
): Record<string, unknown> {
  const params: Record<string, unknown> = {
    model,
    system,
    messages,
    tools,
    ...(maxOutputTokens ? { maxOutputTokens } : {}),
  };

  // Apply Responses API options when the model supports them
  const responsesOpts = buildResponsesProviderOptions(model, providerCallOptions);
  if (responsesOpts) {
    const openaiOpts = responsesOpts.providerOptions.openai as Record<
      string,
      unknown
    >;

    // Move system prompt to instructions for Responses API caching
    if (responsesOpts.stripSystem && system) {
      openaiOpts.instructions = system;
      params.system = undefined;
    }
    if (responsesOpts.stripMaxOutputTokens) {
      params.maxOutputTokens = undefined;
    }

    params.providerOptions = { openai: openaiOpts };
  }

  return params;
}

// ─── Internal: execute tools ────────────────────────────────────────────────

async function executeTool(
  tools: ToolSet,
  name: string,
  args: unknown,
): Promise<string> {
  const tool = tools[name];
  if (!tool) {
    return `Error: unknown tool "${name}"`;
  }
  try {
    // AI SDK tool execute signature is (args, options) — we pass a minimal
    // options object. The cast through unknown avoids fighting the SDK's
    // complex conditional generics.
    const exec = (tool as unknown as { execute?: (...args: unknown[]) => unknown }).execute;
    if (!exec) {
      return `Error: tool "${name}" has no execute function`;
    }
    const result = await exec(args, {});
    return typeof result === "string" ? result : JSON.stringify(result);
  } catch (err) {
    return `Error: ${(err as Error).message}`;
  }
}

// ─── Internal: shared step logic ────────────────────────────────────────────

function makeStepInfo(
  stepIndex: number,
  usage: Record<string, unknown>,
  toolCalls: ToolCallRecord[],
  finishReason: string,
): StepInfo {
  const u = extractUsage(usage);
  return {
    stepIndex,
    inputTokens: u.inputTokens,
    outputTokens: u.outputTokens,
    reasoningTokens: u.reasoningTokens,
    cachedTokens: u.cachedTokens,
    toolCalls: toolCalls.map((tc) => ({ name: tc.toolName, args: tc.args })),
    finishReason,
  };
}

function addUsage(
  total: AgentLoopResult["totalUsage"],
  step: StepInfo,
): void {
  total.inputTokens += step.inputTokens;
  total.outputTokens += step.outputTokens;
  total.reasoningTokens += step.reasoningTokens;
  total.cachedTokens += step.cachedTokens;
}

// ─── Public: non-streaming agent loop ───────────────────────────────────────

/**
 * Run a self-managed agent loop (non-streaming).
 * Returns the final text, message history, total usage, and per-step info.
 */
export async function runAgentLoop(
  options: AgentLoopOptions,
  initialPrompt: string,
): Promise<AgentLoopResult> {
  const { model, system, tools, maxSteps, maxOutputTokens, providerCallOptions, onStep } = options;

  const messages: Message[] = [{ role: "user", content: initialPrompt }];
  const steps: StepInfo[] = [];
  const totalUsage: AgentLoopResult["totalUsage"] = {
    inputTokens: 0,
    outputTokens: 0,
    reasoningTokens: 0,
    cachedTokens: 0,
  };
  let lastText = "";

  for (let stepIndex = 0; stepIndex < maxSteps; stepIndex++) {
    const params = buildStreamParams(model, system, messages, tools, maxOutputTokens, providerCallOptions);

    // withRetry wraps the entire stream lifecycle: creation + all awaits.
    // This ensures SSE timeouts and transient errors during reading are retried.
    const { text, finishReason, usage, toolCalls } = await withRetry(async () => {
      const s = streamText(params as Parameters<typeof streamText>[0]);
      const t = await s.text;
      const fr = (await s.finishReason) ?? "stop";
      const u = ((await s.usage) as Record<string, unknown>) ?? {};
      const raw = (await s.toolCalls) ?? [];
      return { text: t, finishReason: fr, usage: u, toolCalls: normaliseToolCalls(raw as unknown[]) };
    });

    lastText = text;

    const step = makeStepInfo(stepIndex, usage, toolCalls, finishReason);
    steps.push(step);
    addUsage(totalUsage, step);
    onStep?.(step);

    // No tool calls or explicit stop → done
    if (toolCalls.length === 0 || finishReason === "stop") {
      // Append final assistant message
      messages.push({ role: "assistant", content: text });
      break;
    }

    // Build assistant message with text + tool calls
    const assistantParts: AssistantContentPart[] = [];
    if (text) {
      assistantParts.push({ type: "text", text });
    }
    for (const tc of toolCalls) {
      assistantParts.push({
        type: "tool-call",
        toolCallId: tc.toolCallId,
        toolName: tc.toolName,
        input: tc.args,
      });
    }
    messages.push({ role: "assistant", content: assistantParts });

    // Execute tools and append results
    const toolResults: ToolResultPart[] = [];
    for (const tc of toolCalls) {
      const raw = await executeTool(tools, tc.toolName, tc.args);
      toolResults.push({
        type: "tool-result",
        toolCallId: tc.toolCallId,
        toolName: tc.toolName,
        output: { type: "text", value: raw },
      });
    }
    messages.push({ role: "tool", content: toolResults });
  }

  return { text: lastText, messages, totalUsage, steps };
}

// ─── Public: streaming agent loop ───────────────────────────────────────────

/**
 * Run a self-managed agent loop that yields events as they stream.
 * For use in Ask mode where the UI needs incremental updates.
 */
export async function* runAgentLoopStream(
  options: AgentLoopOptions,
  initialPrompt: string,
): AsyncGenerator<AgentLoopEvent> {
  const { model, system, tools, maxSteps, maxOutputTokens, providerCallOptions, onStep } = options;

  const messages: Message[] = [{ role: "user", content: initialPrompt }];
  const steps: StepInfo[] = [];
  const totalUsage: AgentLoopResult["totalUsage"] = {
    inputTokens: 0,
    outputTokens: 0,
    reasoningTokens: 0,
    cachedTokens: 0,
  };
  let lastText = "";

  for (let stepIndex = 0; stepIndex < maxSteps; stepIndex++) {
    const params = buildStreamParams(model, system, messages, tools, maxOutputTokens, providerCallOptions);

    // Design note on streaming retry scope:
    // withRetry wraps stream CREATION only. Mid-stream failures (SSE timeout,
    // network drop during fullStream iteration) cannot be retried here because
    // we've already yielded partial text-deltas to the caller — can't un-yield.
    //
    // For the non-streaming runAgentLoop(), withRetry wraps the entire step
    // (creation + consumption), providing full retry coverage.
    //
    // For streaming, mid-stream SSETimeoutError propagates to the caller
    // (AskStreamService → Web SSE route), which can surface it to the UI
    // for user-initiated retry. resilient-fetch ensures the error surfaces
    // within 2 minutes rather than hanging forever.
    const stream = await withRetry(() =>
      Promise.resolve(streamText(params as Parameters<typeof streamText>[0])),
    );

    // Stream events incrementally — each delta is yielded immediately for real-time UX
    let stepText = "";
    for await (const part of stream.fullStream) {
      switch (part.type) {
        case "text-delta": {
          const d = (part as { delta?: string; textDelta?: string }).delta
            ?? (part as { textDelta?: string }).textDelta ?? "";
          stepText += d;
          yield { type: "text-delta", text: d };
          break;
        }
        case "reasoning-delta": {
          const d = (part as { delta?: string }).delta ?? "";
          yield { type: "reasoning-delta", text: d };
          break;
        }
        case "tool-call": {
          const tc = part as unknown as Record<string, unknown>;
          yield { type: "tool-call", name: tc.toolName as string, args: tc.input ?? tc.args };
          break;
        }
      }
    }

    const finishReason = (await stream.finishReason) ?? "stop";
    const usage = ((await stream.usage) as Record<string, unknown>) ?? {};
    const rawToolCalls = (await stream.toolCalls) ?? [];
    const toolCalls = normaliseToolCalls(rawToolCalls as unknown[]);

    if (stepText) lastText = stepText;

    const step = makeStepInfo(stepIndex, usage, toolCalls, finishReason);
    steps.push(step);
    addUsage(totalUsage, step);
    onStep?.(step);

    yield { type: "step-done", step };

    // No tool calls or explicit stop → done
    if (toolCalls.length === 0 || finishReason === "stop") {
      messages.push({ role: "assistant", content: lastText });
      break;
    }

    // Build assistant message with text + tool calls
    const assistantParts: AssistantContentPart[] = [];
    if (lastText) {
      assistantParts.push({ type: "text", text: lastText });
    }
    for (const tc of toolCalls) {
      assistantParts.push({
        type: "tool-call",
        toolCallId: tc.toolCallId,
        toolName: tc.toolName,
        input: tc.args,
      });
    }
    messages.push({ role: "assistant", content: assistantParts });

    // Execute tools and yield results
    const toolResults: ToolResultPart[] = [];
    for (const tc of toolCalls) {
      const raw = await executeTool(tools, tc.toolName, tc.args);
      toolResults.push({
        type: "tool-result",
        toolCallId: tc.toolCallId,
        toolName: tc.toolName,
        output: { type: "text", value: raw },
      });
      yield { type: "tool-result", name: tc.toolName, output: raw };
    }
    messages.push({ role: "tool", content: toolResults });
  }

  const result: AgentLoopResult = {
    text: lastText,
    messages,
    totalUsage,
    steps,
  };

  yield { type: "done", result };
}
