import type { LanguageModel, ToolSet } from "ai";
import type { Message, StepInfo } from "../agent/agent-loop.js";

export type TurnPurpose =
  | "catalog" | "outline" | "draft" | "worker" | "review"
  | "ask" | "research-plan" | "research-exec" | "research-synthesize"
  | "evidence-plan";

export type ProviderCallOptions = {
  cacheKey?: string;
  reasoning?: { effort: string; summary: string } | null;
  serviceTier?: string | null;
};

/**
 * Internal types reserved for future use. Retry behavior is handled by
 * agent-loop.ts's `withRetry` and is not yet configurable through TurnPolicy.
 * @internal
 */
export type RetryPolicy = { maxRetries: number; baseDelayMs: number; backoffFactor: number };
/** @internal */
export type OverflowPolicy = { strategy: "none" | "truncate" | "compact" };
/** @internal */
export type ToolBatchPolicy = { strategy: "sequential" | "parallel" };

export type TurnPolicy = {
  maxSteps: number;
  maxOutputTokens?: number;
  providerOptions?: ProviderCallOptions;
};

export type TurnRequest = {
  purpose: TurnPurpose;
  model: LanguageModel;
  systemPrompt: string;
  userPrompt: string;
  tools: ToolSet;
  policy: TurnPolicy;
  onStep?: (step: StepInfo) => void;
};

export type TurnResult = {
  text: string;
  messages: Message[];
  usage: { inputTokens: number; outputTokens: number; reasoningTokens: number; cachedTokens: number };
  steps: StepInfo[];
  finishReason: string;
};
