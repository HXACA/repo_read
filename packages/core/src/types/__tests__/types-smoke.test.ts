import { describe, it, expect } from "vitest";
import type {
  RoleModelConfig,
  UserEditableConfig,
  ResolvedConfig,
  GenerationJob,
  ReviewConclusion,
  AppEvent,
} from "../index.js";

describe("core types", () => {
  it("RoleModelConfig is structurally correct", () => {
    const config: RoleModelConfig = {
      model: "claude-opus-4-6",
      fallback_models: ["claude-sonnet-4-6"],
    };
    expect(config.model).toBe("claude-opus-4-6");
    expect(config.fallback_models).toHaveLength(1);
  });

  it("UserEditableConfig is structurally correct", () => {
    const config: UserEditableConfig = {
      projectSlug: "my-project",
      repoRoot: "/home/user/repo",
      preset: "quality",
      providers: [
        { provider: "anthropic", secretRef: "anthropic-key", enabled: true },
      ],
      roles: {
        "main.author": { model: "claude-opus-4-6", fallback_models: [] },
        "fork.worker": { model: "claude-sonnet-4-6", fallback_models: [] },
        "fresh.reviewer": { model: "claude-opus-4-6", fallback_models: [] },
      },
    };
    expect(config.preset).toBe("quality");
    expect(config.roles["main.author"].model).toBe("claude-opus-4-6");
  });

  it("GenerationJob status enum is valid", () => {
    const job: GenerationJob = {
      id: "job-1",
      projectSlug: "test",
      repoRoot: "/tmp/repo",
      versionId: "v1",
      status: "cataloging",
      createdAt: new Date().toISOString(),
      configSnapshot: {} as ResolvedConfig,
      summary: {},
    };
    expect(job.status).toBe("cataloging");
  });

  it("ReviewConclusion verdict is valid", () => {
    const review: ReviewConclusion = {
      verdict: "pass",
      blockers: [],
      factual_risks: [],
      missing_evidence: [],
      scope_violations: [],
      suggested_revisions: [],
    };
    expect(review.verdict).toBe("pass");
  });

  it("AppEvent has required fields", () => {
    const event: AppEvent = {
      id: "evt-1",
      channel: "job",
      type: "job.started",
      at: new Date().toISOString(),
      projectId: "proj-1",
      payload: { jobId: "job-1" },
    };
    expect(event.channel).toBe("job");
  });
});
