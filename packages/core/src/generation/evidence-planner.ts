import type { LanguageModel, ToolSet } from "ai";
import { extractJson } from "../utils/extract-json.js";
import type { ProviderCallOptions } from "../runtime/turn-types.js";
import { PromptAssembler } from "../prompt/assembler.js";
import { TurnEngineAdapter } from "../runtime/turn-engine.js";

/**
 * A single evidence-gathering subtask that a `worker` will execute.
 * The planner divides the page's covered files into N semantically
 * meaningful tasks rather than blindly splitting by count.
 */
export type EvidenceTask = {
  id: string;
  directive: string;
  targetFiles: string[];
  rationale: string;
};

export type EvidencePlan = {
  tasks: EvidenceTask[];
};

export type EvidencePlanInput = {
  pageTitle: string;
  pageRationale: string;
  coveredFiles: string[];
  pageOrder: number;
  publishedSummaries: Array<{ slug: string; title: string; summary: string }>;
  taskCount: number;
  language: string;
};

export type EvidencePlannerOptions = {
  model: LanguageModel;
  providerCallOptions?: ProviderCallOptions;
};

export type EvidencePlanResult =
  | { success: true; plan: EvidencePlan }
  | { success: false; error: string };

const LANGUAGE_NAMES: Record<string, string> = {
  zh: "简体中文",
  en: "English",
  ja: "日本語",
  ko: "한국어",
  fr: "Français",
  de: "Deutsch",
  es: "Español",
};

/**
 * Plans how to split a page's evidence-gathering work across N parallel
 * `worker` subtasks. The planner is a pure LLM call — it does NOT
 * execute tools itself. Each task returns with a directive (what to look
 * for) and a targetFiles list (where to look).
 *
 * This replaces the earlier naive "even file-count split" approach: the
 * drafter model knows the page plan and can assign semantic
 * responsibilities (e.g. "find all FastAPI routes in api/api.py" vs
 * "collect Pydantic models from api/models.py").
 */
export class EvidencePlanner {
  private readonly model: LanguageModel;
  private readonly providerCallOptions?: ProviderCallOptions;
  private readonly promptAssembler = new PromptAssembler();
  private readonly turnEngine = new TurnEngineAdapter();

  constructor(options: EvidencePlannerOptions) {
    this.model = options.model;
    this.providerCallOptions = options.providerCallOptions;
  }

  async plan(input: EvidencePlanInput): Promise<EvidencePlanResult> {
    const effectiveTaskCount = Math.min(
      input.taskCount,
      Math.max(1, input.coveredFiles.length),
    );

    // Fast path: if only one task is needed, skip the LLM and return a
    // trivially correct single-task plan. This saves a round-trip for
    // budget/local-only presets where forkWorkers === 1.
    if (effectiveTaskCount === 1) {
      return {
        success: true,
        plan: {
          tasks: [
            {
              id: "t1",
              directive: buildFallbackDirective(
                input.pageTitle,
                input.language,
              ),
              targetFiles: [...input.coveredFiles],
              rationale:
                input.language === "zh"
                  ? "单 worker 模式，收集整页所有证据"
                  : "Single-worker mode, collect all evidence for the page",
            },
          ],
        },
      };
    }

    const systemPrompt = buildPlannerSystemPrompt();
    const userPrompt = buildPlannerUserPrompt(input, effectiveTaskCount);
    const assembled = this.promptAssembler.assemble({ role: "evidence-plan", language: input.language, systemPrompt, userPrompt });

    try {
      const result = await this.turnEngine.run({
        purpose: "evidence-plan",
        model: this.model,
        systemPrompt: assembled.system,
        userPrompt: assembled.user,
        tools: {} as ToolSet,
        policy: {
          maxSteps: 1,
          providerOptions: this.providerCallOptions,
        },
      });

      const parsed = extractJson(result.text);
      if (!parsed || !Array.isArray(parsed.tasks)) {
        return {
          success: false,
          error: "Planner output missing tasks array",
        };
      }

      const tasks = normalizeTasks(
        parsed.tasks as unknown[],
        input.coveredFiles,
        effectiveTaskCount,
      );

      const validation = validatePlan(
        { tasks },
        input.coveredFiles,
        effectiveTaskCount,
      );
      if (!validation.ok) {
        return { success: false, error: validation.reason };
      }

      return { success: true, plan: { tasks } };
    } catch (err) {
      return {
        success: false,
        error: `Evidence planner failed: ${(err as Error).message}`,
      };
    }
  }
}

/**
 * Deterministic fallback: when the planner LLM call fails, split covered
 * files evenly into `taskCount` buckets and produce a generic directive
 * for each bucket. Guarantees the coordinator can still proceed.
 */
export function fallbackPlan(input: EvidencePlanInput): EvidencePlan {
  const count = Math.min(
    input.taskCount,
    Math.max(1, input.coveredFiles.length),
  );
  const tasks: EvidenceTask[] = [];
  const files = input.coveredFiles;
  const perBucket = Math.ceil(files.length / count);

  for (let i = 0; i < count; i++) {
    const bucket = files.slice(i * perBucket, (i + 1) * perBucket);
    if (bucket.length === 0) continue;
    tasks.push({
      id: `t${i + 1}`,
      directive: buildFallbackDirective(input.pageTitle, input.language),
      targetFiles: bucket,
      rationale:
        input.language === "zh"
          ? `分组 ${i + 1}（按文件数均分）`
          : `Bucket ${i + 1} (even split by file count)`,
    });
  }
  return { tasks };
}

function buildFallbackDirective(pageTitle: string, language: string): string {
  if (language === "zh") {
    return `收集这些文件中与「${pageTitle}」相关的关键结构、函数、类型和可引用的行片段`;
  }
  return `Collect key structures, functions, types, and citation-worthy line ranges from these files relevant to "${pageTitle}"`;
}

function buildPlannerSystemPrompt(): string {
  return `You are the evidence-planning step of the "drafter" role in a code-reading wiki generator.

Your job: split a page's evidence-gathering work into N parallel subtasks that will be dispatched to independent worker agents. Each subtask must be semantically meaningful (what to look for), not just a slice of the file list.

You do NOT execute any tools. You do NOT read any files. You only plan.

Rules:
1. Output exactly \`taskCount\` tasks.
2. Every covered file must appear in at least one task's targetFiles.
3. Each task must have at least one target file.
4. Each task's directive must describe what EVIDENCE to look for (symbols, types, routes, flows, configs, etc.), not just "read these files".
5. Group files by topic when it makes sense (e.g. put router files together, model files together).
6. Output ONLY a single JSON object. No prose before or after. No markdown fences.

Output schema:

{
  "tasks": [
    {
      "id": "t1",
      "directive": "<natural language, what to look for>",
      "targetFiles": ["path1", "path2"],
      "rationale": "<why these files belong to this task>"
    }
  ]
}`;
}

function buildPlannerUserPrompt(
  input: EvidencePlanInput,
  taskCount: number,
): string {
  const langName = LANGUAGE_NAMES[input.language] ?? input.language;
  const sections: string[] = [];

  sections.push(`## Page`);
  sections.push(`- **Title:** ${input.pageTitle}`);
  sections.push(`- **Position:** Page ${input.pageOrder}`);
  sections.push(`- **Rationale:** ${input.pageRationale}`);
  sections.push(`- **Output language for directives:** ${langName}`);

  sections.push(`## Covered Files (${input.coveredFiles.length})`);
  for (const f of input.coveredFiles) {
    sections.push(`- ${f}`);
  }

  if (input.publishedSummaries.length > 0) {
    sections.push(`## Previously Published Pages (for context only)`);
    for (const p of input.publishedSummaries.slice(-6)) {
      sections.push(`- **${p.title}** (${p.slug}): ${p.summary.slice(0, 120)}`);
    }
  }

  sections.push(`## Instructions`);
  sections.push(
    `Produce exactly ${taskCount} evidence-gathering tasks that together cover all the files above. Write directives and rationales in **${langName}**. Output only the JSON object.`,
  );

  return sections.join("\n\n");
}

/** Normalize LLM-generated tasks to our strict shape, filling missing ids. */
function normalizeTasks(
  rawTasks: unknown[],
  coveredFiles: string[],
  expectedCount: number,
): EvidenceTask[] {
  const tasks: EvidenceTask[] = [];
  let autoId = 1;

  for (const raw of rawTasks) {
    if (!raw || typeof raw !== "object") continue;
    const r = raw as Record<string, unknown>;

    const id = typeof r.id === "string" && r.id.trim() ? r.id.trim() : `t${autoId}`;
    const directive =
      typeof r.directive === "string" ? r.directive.trim() : "";
    const rationale =
      typeof r.rationale === "string" ? r.rationale.trim() : "";
    const targetFiles = Array.isArray(r.targetFiles)
      ? (r.targetFiles as unknown[])
          .filter((f): f is string => typeof f === "string" && f.trim() !== "")
          .map((f) => f.trim())
          // Only keep files the caller declared as covered
          .filter((f) => coveredFiles.includes(f))
      : [];

    if (!directive || targetFiles.length === 0) continue;

    tasks.push({ id, directive, targetFiles, rationale });
    autoId++;
    if (tasks.length === expectedCount) break;
  }

  return tasks;
}

function validatePlan(
  plan: EvidencePlan,
  coveredFiles: string[],
  expectedCount: number,
): { ok: true } | { ok: false; reason: string } {
  if (plan.tasks.length !== expectedCount) {
    return {
      ok: false,
      reason: `Expected ${expectedCount} tasks, got ${plan.tasks.length}`,
    };
  }
  const unionCovered = new Set<string>();
  for (const t of plan.tasks) {
    if (t.targetFiles.length === 0) {
      return { ok: false, reason: `Task ${t.id} has no target files` };
    }
    if (!t.directive.trim()) {
      return { ok: false, reason: `Task ${t.id} has empty directive` };
    }
    for (const f of t.targetFiles) unionCovered.add(f);
  }
  for (const f of coveredFiles) {
    if (!unionCovered.has(f)) {
      return { ok: false, reason: `Covered file "${f}" not assigned to any task` };
    }
  }
  return { ok: true };
}
