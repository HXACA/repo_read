import { runAgentLoop } from "../agent/agent-loop.js";
import { setModelOptions } from "../utils/generate-via-stream.js";
import type { TurnRequest, TurnResult } from "./turn-types.js";

type RunAgentLoopLike = typeof runAgentLoop;

export type TurnEngineAdapterOptions = {
  invokeTurn?: RunAgentLoopLike;
  setModelOptions?: typeof setModelOptions;
};

export class TurnEngineAdapter {
  private readonly invokeTurn: RunAgentLoopLike;
  private readonly applyModelOptions: typeof setModelOptions;

  constructor(options: TurnEngineAdapterOptions = {}) {
    this.invokeTurn = options.invokeTurn ?? runAgentLoop;
    this.applyModelOptions = options.setModelOptions ?? setModelOptions;
  }

  async run(request: TurnRequest): Promise<TurnResult> {
    // Apply provider options (Phase 0: still uses global setters; Phase 1 will make this request-scoped)
    const providerOptions = request.policy.providerOptions;
    if (providerOptions?.reasoning || providerOptions?.serviceTier) {
      this.applyModelOptions({
        reasoning: providerOptions.reasoning ?? null,
        serviceTier: providerOptions.serviceTier ?? null,
      });
    }

    const result = await this.invokeTurn(
      {
        model: request.model,
        system: request.systemPrompt,
        tools: request.tools,
        maxSteps: request.policy.maxSteps,
        maxOutputTokens: request.policy.maxOutputTokens,
        onStep: request.onStep,
      },
      request.userPrompt,
    );

    return {
      text: result.text,
      messages: result.messages,
      usage: {
        inputTokens: result.totalUsage.inputTokens,
        outputTokens: result.totalUsage.outputTokens,
        reasoningTokens: result.totalUsage.reasoningTokens,
        cachedTokens: result.totalUsage.cachedTokens,
      },
      steps: result.steps,
      finishReason: result.steps[result.steps.length - 1]?.finishReason ?? "unknown",
    };
  }
}
