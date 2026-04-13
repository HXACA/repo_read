import type { LanguageModel, ToolSet } from "ai";
import type { Message, StepInfo } from "../agent/agent-loop.js";

export type TurnPurpose =
  | "catalog" | "outline" | "draft" | "worker" | "review"
  | "ask" | "research-plan" | "research-exec" | "research-synthesize";

export type ProviderCallOptions = {
  cacheKey?: string;
  reasoning?: { effort: string; summary: string } | null;
  serviceTier?: string | null;
};

export type RetryPolicy = { maxRetries: number; baseDelayMs: number; backoffFactor: number };
export type OverflowPolicy = { strategy: "none" | "truncate" | "compact" };
export type ToolBatchPolicy = { strategy: "sequential" | "parallel" };

export type TurnPolicy = {
  maxSteps: number;
  maxOutputTokens?: number;
  retry: RetryPolicy;
  overflow: OverflowPolicy;
  toolBatch: ToolBatchPolicy;
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
