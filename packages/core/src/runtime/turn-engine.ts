import { runAgentLoop } from "../agent/agent-loop.js";
import type { TurnRequest, TurnResult } from "./turn-types.js";

type RunAgentLoopLike = typeof runAgentLoop;

export type TurnEngineAdapterOptions = {
  invokeTurn?: RunAgentLoopLike;
};

export class TurnEngineAdapter {
  private readonly invokeTurn: RunAgentLoopLike;

  constructor(options: TurnEngineAdapterOptions = {}) {
    this.invokeTurn = options.invokeTurn ?? runAgentLoop;
  }

  async run(request: TurnRequest): Promise<TurnResult> {
    const result = await this.invokeTurn(
      {
        model: request.model,
        system: request.systemPrompt,
        tools: request.tools,
        maxSteps: request.policy.maxSteps,
        maxOutputTokens: request.policy.maxOutputTokens,
        providerCallOptions: request.policy.providerOptions,
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
