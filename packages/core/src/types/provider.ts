export type ProviderHealth = "healthy" | "degraded" | "unavailable";

export type ModelCapability = {
  model: string;
  provider: string;
  supportsStreaming: boolean;
  supportsToolCalls: boolean;
  supportsJsonSchema: boolean;
  supportsLongContext: boolean;
  supportsReasoningContent: boolean;
  isLocalModel: boolean;
  health: ProviderHealth;
  checkedAt: string;
};

export type SystemPromptTuningProfile = {
  family: string;
  reasoning_style: "tight" | "balanced" | "long-form";
  tool_call_style: "strict-json" | "xml-like" | "freeform-guarded";
  citation_style: "inline" | "footnote" | "ledger-first";
  retry_policy: "single-reask" | "fallback-model" | "abort-fast";
};
