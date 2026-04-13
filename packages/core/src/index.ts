export { AppError } from "./errors.js";
export type { ErrorCode } from "./errors.js";
export * from "./types/index.js";
export { UserEditableConfigSchema, parseUserEditableConfig } from "./config/index.js";
export type { UserEditableConfigInput } from "./config/index.js";
export { loadProjectConfig, saveProjectConfig, resolveConfig, resolveApiKeys } from "./config/index.js";
export { SecretStore } from "./secrets/index.js";
export type { SecretBackend, SecretStoreOptions } from "./secrets/index.js";
export { ProviderCenter, getStaticCapabilities, buildFallbackChain, createModelForRole, getModelOptionsForRole } from "./providers/index.js";
export type { ModelFactoryOptions } from "./providers/index.js";
export { StoragePaths, StorageAdapter } from "./storage/index.js";
export { ProjectModel } from "./project/index.js";
export type { CreateProjectInput } from "./project/index.js";
export { profileRepo } from "./project/index.js";
export { createAppEvent, EventWriter, EventReader, createSSEStream, formatSSE } from "./events/index.js";
export { JobStateManager } from "./generation/index.js";
export {
  JobEventEmitter, PageDrafter, ForkWorker, Publisher,
  determineResumePoint, GenerationPipeline,
  buildPageDraftSystemPrompt, buildPageDraftUserPrompt,
  buildForkWorkerSystemPrompt, buildForkWorkerUserPrompt,
} from "./generation/index.js";
export type { PipelineEventCallback } from "./generation/generation-events.js";
export type {
  PageDraftResult, PageDrafterOptions, PageDraftPromptInput,
  ForkWorkerResponse, ForkWorkerOptions, ForkWorkerInput,
  ResumePoint, GenerationPipelineOptions, PipelineResult,
} from "./generation/index.js";
export { PathPolicy, validateBashCommand } from "./policy/index.js";
export { setDebugDir } from "./utils/debug-fetch.js";
export { setModelOptions, buildResponsesProviderOptions } from "./utils/generate-via-stream.js";
export type { BashValidationResult } from "./policy/index.js";
export {
  readFile, grepSearch, findFiles,
  gitLog, gitShow, gitDiff,
  execBash, pageRead, citationOpen,
} from "./tools/index.js";
export {
  CatalogPlanner, buildCatalogSystemPrompt, buildCatalogUserPrompt,
  persistCatalog, validateCatalog, createCatalogTools,
} from "./catalog/index.js";
export type { CatalogPlannerOptions, CatalogPlanResult } from "./catalog/index.js";

export { FreshReviewer, buildReviewerSystemPrompt, buildReviewerUserPrompt } from "./review/index.js";
export type { ReviewResult, FreshReviewerOptions } from "./review/index.js";

export {
  validatePage, validateStructure, validateCitations,
  validateMermaid, validateLinks,
} from "./validation/index.js";
export type { PageValidationInput } from "./validation/index.js";

export { classifyRoute, AskSessionManager, AskService, AskStreamService } from "./ask/index.js";
export type { AskRoute, RouteContext, AskOptions, AskResult, AskStreamOptions, AskStreamEvent } from "./ask/index.js";

export { ResearchPlanner, ResearchExecutor, ResearchService } from "./research/index.js";
export type {
  ResearchPlan, ResearchPlannerOptions,
  SubQuestionResult, ResearchExecutorOptions,
  ResearchResult, ResearchServiceOptions,
} from "./research/index.js";

export { CitationLedger } from "./wiki/index.js";
export type { PageCitations } from "./wiki/index.js";

export { UsageTracker } from "./utils/usage-tracker.js";
export type { UsageBucket, UsageInput, JobUsage } from "./utils/usage-tracker.js";
export { runAgentLoop, runAgentLoopStream } from "./agent/agent-loop.js";
export type { AgentLoopOptions, AgentLoopResult, AgentLoopEvent, StepInfo } from "./agent/agent-loop.js";
