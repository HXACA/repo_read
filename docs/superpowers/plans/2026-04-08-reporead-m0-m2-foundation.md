# RepoRead M0-M2 Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the complete engineering foundation (monorepo scaffold, config/secrets/providers, storage/events/project model) so that M3+ (catalog, generation, review, validation) can begin on a stable base.

**Architecture:** Three-package pnpm monorepo (`@reporead/core`, `@reporead/cli`, `@reporead/web`). Core provides all business logic and types. CLI wraps core with Commander.js + Ink. Web wraps core with Next.js 15 + Tailwind. All packages share TypeScript strict mode, Vitest, and Zod v4 schemas.

**Tech Stack:** Node.js 22 LTS, pnpm workspace, TypeScript 5.x strict, Zod v4, Vitest, Commander.js, Ink 5, React 18, Next.js 15 (App Router), Tailwind CSS 4, Vercel AI SDK, keytar

---

## Scope

This plan covers **M0 (B001-B004)**, **M1 (B010-B015)**, and **M2 (B020-B024)**. Web UI tasks (B016, B023, B025, B026) are deferred to a separate plan as they depend on this foundation but are not on the critical path.

**Not in scope:** M3+ (catalog, generation, review, tools, retrieval), Web provider UI (B016), Web project pages (B026), CLI jobs/versions (B025).

---

## File Structure

### Root

```
repo-read/
├── package.json                  # Root workspace scripts
├── pnpm-workspace.yaml           # Workspace definition
├── tsconfig.base.json            # Shared compiler options
├── vitest.workspace.ts           # Vitest workspace config
├── .eslintrc.cjs                 # Shared lint rules
├── .prettierrc                   # Formatting
├── .npmrc                        # pnpm settings
├── .nvmrc                        # Node version pin
└── .gitignore                    # Updated for monorepo
```

### packages/core

```
packages/core/
├── package.json
├── tsconfig.json
├── vitest.config.ts
└── src/
    ├── index.ts                          # Public barrel export
    ├── errors.ts                         # AppError base class
    ├── types/
    │   ├── index.ts                      # Re-export all types
    │   ├── config.ts                     # UserEditableConfig, ResolvedConfig, etc.
    │   ├── provider.ts                   # ModelCapability, ProviderCredentialConfig
    │   ├── project.ts                    # RepoProfile
    │   ├── generation.ts                 # GenerationJob, PageMeta, WikiJson
    │   ├── review.ts                     # ReviewBriefing, ReviewConclusion
    │   ├── validation.ts                 # ValidationReport
    │   ├── events.ts                     # AppEvent
    │   └── agent.ts                      # MainAuthorContext, ForkWorkerResult
    ├── config/
    │   ├── index.ts
    │   ├── schema.ts                     # Zod schemas for config
    │   ├── loader.ts                     # Load config from disk
    │   ├── resolver.ts                   # Merge and resolve config
    │   └── __tests__/
    │       ├── schema.test.ts
    │       ├── loader.test.ts
    │       └── resolver.test.ts
    ├── secrets/
    │   ├── index.ts
    │   ├── secret-store.ts               # keytar wrapper + env fallback
    │   └── __tests__/
    │       └── secret-store.test.ts
    ├── providers/
    │   ├── index.ts
    │   ├── provider-interface.ts         # Abstract provider contract
    │   ├── capability.ts                 # Static capability table + probe
    │   ├── model-route.ts                # Role routing + fallback resolution
    │   ├── provider-center.ts            # ProviderCenterService
    │   ├── adapters/
    │   │   ├── openai.ts
    │   │   ├── anthropic.ts
    │   │   └── openai-compatible.ts
    │   └── __tests__/
    │       ├── capability.test.ts
    │       ├── model-route.test.ts
    │       └── provider-center.test.ts
    ├── storage/
    │   ├── index.ts
    │   ├── paths.ts                      # Path builders for .reporead
    │   ├── storage-adapter.ts            # Read/write/ensure directories
    │   ├── current-state.ts              # current.json management
    │   └── __tests__/
    │       ├── paths.test.ts
    │       ├── storage-adapter.test.ts
    │       └── current-state.test.ts
    ├── project/
    │   ├── index.ts
    │   ├── project-model.ts              # Project CRUD, project.json
    │   └── __tests__/
    │       └── project-model.test.ts
    ├── events/
    │   ├── index.ts
    │   ├── app-event.ts                  # Event type definitions + factory
    │   ├── event-writer.ts               # Append to events.ndjson
    │   ├── event-reader.ts               # Read/replay from events.ndjson
    │   └── __tests__/
    │       ├── app-event.test.ts
    │       ├── event-writer.test.ts
    │       └── event-reader.test.ts
    └── generation/
        ├── index.ts
        ├── job-state.ts                  # Job state machine + persistence
        └── __tests__/
            └── job-state.test.ts
```

### packages/cli

```
packages/cli/
├── package.json
├── tsconfig.json
├── vitest.config.ts
└── src/
    ├── index.ts                          # Entry point: parse args, run
    ├── cli.tsx                           # Commander program definition
    ├── commands/
    │   ├── init.tsx                      # repo-read init
    │   └── providers.tsx                 # repo-read providers
    ├── components/
    │   └── status-bar.tsx                # Shared Ink status bar
    ├── utils/
    │   └── ink-helpers.ts
    └── __tests__/
        ├── cli.test.ts
        └── commands/
            ├── init.test.ts
            └── providers.test.ts
```

### packages/web

```
packages/web/
├── package.json
├── tsconfig.json
├── next.config.ts
├── tailwind.config.ts
├── postcss.config.mjs
└── src/
    ├── app/
    │   ├── layout.tsx                    # Root layout
    │   ├── page.tsx                      # Home / project selector
    │   └── globals.css                   # Tailwind base
    └── lib/
        └── core-client.ts               # Import from @reporead/core
```

---

## Task 1: Root Monorepo Scaffold (B001)

**Files:**
- Create: `package.json`
- Create: `pnpm-workspace.yaml`
- Create: `.npmrc`
- Create: `.nvmrc`
- Create: `.gitignore` (update existing)

- [ ] **Step 1: Create pnpm-workspace.yaml**

```yaml
packages:
  - "packages/*"
```

- [ ] **Step 2: Create root package.json**

```json
{
  "name": "repo-read",
  "private": true,
  "type": "module",
  "engines": {
    "node": ">=22.0.0"
  },
  "packageManager": "pnpm@9.15.4",
  "scripts": {
    "build": "pnpm -r run build",
    "test": "vitest run",
    "test:watch": "vitest",
    "lint": "eslint packages/*/src --ext .ts,.tsx",
    "typecheck": "pnpm -r run typecheck",
    "clean": "pnpm -r run clean"
  },
  "devDependencies": {
    "typescript": "^5.7.0",
    "vitest": "^3.1.0",
    "@vitest/coverage-v8": "^3.1.0",
    "eslint": "^9.0.0",
    "@eslint/js": "^9.0.0",
    "typescript-eslint": "^8.0.0",
    "prettier": "^3.4.0"
  }
}
```

- [ ] **Step 3: Create .npmrc**

```ini
auto-install-peers=true
shamefully-hoist=false
strict-peer-dependencies=false
```

- [ ] **Step 4: Create .nvmrc**

```
22
```

- [ ] **Step 5: Update .gitignore**

```gitignore
# Dependencies
node_modules/

# Build outputs
dist/
.next/
.turbo/

# Environment
.env
.env.local
.env.*.local

# IDE
.vscode/
.idea/
*.swp
*.swo

# OS
.DS_Store
Thumbs.db

# RepoRead runtime
.reporead/

# Test
coverage/

# Logs
*.log

# Claude
.claude/
```

- [ ] **Step 6: Create packages/core/package.json**

```json
{
  "name": "@reporead/core",
  "version": "0.1.0",
  "type": "module",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": {
      "import": "./dist/index.js",
      "types": "./dist/index.d.ts"
    }
  },
  "scripts": {
    "build": "tsc",
    "typecheck": "tsc --noEmit",
    "clean": "rm -rf dist",
    "test": "vitest run",
    "test:watch": "vitest"
  },
  "dependencies": {
    "zod": "^4.0.0"
  },
  "devDependencies": {
    "typescript": "^5.7.0",
    "vitest": "^3.1.0"
  }
}
```

- [ ] **Step 7: Create packages/cli/package.json**

```json
{
  "name": "@reporead/cli",
  "version": "0.1.0",
  "type": "module",
  "bin": {
    "repo-read": "./dist/index.js"
  },
  "scripts": {
    "build": "tsc",
    "typecheck": "tsc --noEmit",
    "clean": "rm -rf dist",
    "dev": "tsx src/index.ts",
    "test": "vitest run",
    "test:watch": "vitest"
  },
  "dependencies": {
    "@reporead/core": "workspace:*",
    "commander": "^13.0.0",
    "ink": "^5.1.0",
    "react": "^18.3.0"
  },
  "devDependencies": {
    "typescript": "^5.7.0",
    "vitest": "^3.1.0",
    "tsx": "^4.19.0",
    "@types/react": "^18.3.0"
  }
}
```

- [ ] **Step 8: Create packages/web/package.json**

```json
{
  "name": "@reporead/web",
  "version": "0.1.0",
  "type": "module",
  "scripts": {
    "dev": "next dev",
    "build": "next build",
    "start": "next start",
    "typecheck": "tsc --noEmit",
    "clean": "rm -rf .next dist"
  },
  "dependencies": {
    "@reporead/core": "workspace:*",
    "next": "^15.3.0",
    "react": "^18.3.0",
    "react-dom": "^18.3.0"
  },
  "devDependencies": {
    "typescript": "^5.7.0",
    "@types/react": "^18.3.0",
    "@types/react-dom": "^18.3.0",
    "@tailwindcss/postcss": "^4.0.0",
    "tailwindcss": "^4.0.0"
  }
}
```

- [ ] **Step 9: Run pnpm install and verify workspace**

Run: `pnpm install`
Expected: All three packages installed, workspace links created.

Run: `pnpm ls -r --depth 0`
Expected: Shows `@reporead/core`, `@reporead/cli`, `@reporead/web` with workspace links.

- [ ] **Step 10: Commit**

```bash
git add -A
git commit -m "feat(B001): monorepo scaffold with pnpm workspace

Set up root workspace with three packages: @reporead/core,
@reporead/cli, @reporead/web. Pin Node.js 22 LTS."
```

---

## Task 2: Shared TypeScript, Lint, and Test Infrastructure (B002)

**Files:**
- Create: `tsconfig.base.json`
- Create: `packages/core/tsconfig.json`
- Create: `packages/cli/tsconfig.json`
- Create: `packages/web/tsconfig.json`
- Create: `vitest.workspace.ts`
- Create: `packages/core/vitest.config.ts`
- Create: `packages/cli/vitest.config.ts`
- Create: `.eslintrc.cjs`
- Create: `.prettierrc`

- [ ] **Step 1: Create tsconfig.base.json**

```json
{
  "compilerOptions": {
    "target": "ES2023",
    "module": "Node16",
    "moduleResolution": "Node16",
    "lib": ["ES2023"],
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true,
    "outDir": "./dist",
    "rootDir": "./src"
  }
}
```

- [ ] **Step 2: Create packages/core/tsconfig.json**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "./dist",
    "rootDir": "./src"
  },
  "include": ["src/**/*.ts"]
}
```

- [ ] **Step 3: Create packages/cli/tsconfig.json**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "./dist",
    "rootDir": "./src",
    "jsx": "react-jsx"
  },
  "include": ["src/**/*.ts", "src/**/*.tsx"],
  "references": [
    { "path": "../core" }
  ]
}
```

- [ ] **Step 4: Create packages/web/tsconfig.json**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "./dist",
    "rootDir": "./src",
    "jsx": "preserve",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "plugins": [{ "name": "next" }],
    "paths": {
      "@/*": ["./src/*"]
    }
  },
  "include": ["src/**/*.ts", "src/**/*.tsx", "next-env.d.ts"],
  "exclude": ["node_modules"]
}
```

- [ ] **Step 5: Create vitest.workspace.ts**

```ts
import { defineWorkspace } from "vitest/config";

export default defineWorkspace([
  "packages/core/vitest.config.ts",
  "packages/cli/vitest.config.ts",
]);
```

- [ ] **Step 6: Create packages/core/vitest.config.ts**

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/__tests__/**/*.test.ts"],
    globals: true,
  },
});
```

- [ ] **Step 7: Create packages/cli/vitest.config.ts**

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/__tests__/**/*.test.ts"],
    globals: true,
  },
});
```

- [ ] **Step 8: Create .eslintrc.cjs**

```js
module.exports = {
  root: true,
  parser: "@typescript-eslint/parser",
  plugins: ["@typescript-eslint"],
  extends: [
    "eslint:recommended",
    "plugin:@typescript-eslint/recommended",
  ],
  env: {
    node: true,
    es2023: true,
  },
  rules: {
    "@typescript-eslint/no-unused-vars": [
      "error",
      { argsIgnorePattern: "^_" },
    ],
    "@typescript-eslint/explicit-function-return-type": "off",
    "@typescript-eslint/no-explicit-any": "error",
  },
  ignorePatterns: ["dist/", "node_modules/", ".next/"],
};
```

- [ ] **Step 9: Create .prettierrc**

```json
{
  "semi": true,
  "singleQuote": false,
  "trailingComma": "all",
  "printWidth": 100,
  "tabWidth": 2
}
```

- [ ] **Step 10: Verify type-check passes**

Run: `pnpm typecheck`
Expected: All packages pass (no source files yet, so trivially passes).

Run: `pnpm test`
Expected: No tests found (expected at this point).

- [ ] **Step 11: Commit**

```bash
git add -A
git commit -m "feat(B002): shared TS, lint, test infrastructure

Add tsconfig.base.json, per-package tsconfigs, vitest workspace,
eslint, and prettier configuration."
```

---

## Task 3: Core Public Types (B003)

**Files:**
- Create: `packages/core/src/errors.ts`
- Create: `packages/core/src/types/config.ts`
- Create: `packages/core/src/types/provider.ts`
- Create: `packages/core/src/types/project.ts`
- Create: `packages/core/src/types/generation.ts`
- Create: `packages/core/src/types/review.ts`
- Create: `packages/core/src/types/validation.ts`
- Create: `packages/core/src/types/events.ts`
- Create: `packages/core/src/types/agent.ts`
- Create: `packages/core/src/types/index.ts`
- Create: `packages/core/src/index.ts`
- Test: `packages/core/src/types/__tests__/types-smoke.test.ts`

- [ ] **Step 1: Write the type smoke test**

```ts
// packages/core/src/types/__tests__/types-smoke.test.ts
import { describe, it, expect } from "vitest";
import type {
  RoleModelConfig,
  ProjectRoleConfig,
  ProviderCredentialConfig,
  UserEditableConfig,
  ResolvedRoleRoute,
  ResolvedConfig,
  ModelCapability,
  SystemPromptTuningProfile,
  RepoProfile,
  WikiJson,
  PageMeta,
  GenerationJob,
  ReviewBriefing,
  ReviewConclusion,
  ValidationReport,
  ForkWorkerResult,
  MainAuthorContext,
  AppEvent,
  AskSession,
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
        {
          provider: "anthropic",
          secretRef: "anthropic-key",
          enabled: true,
        },
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @reporead/core test`
Expected: FAIL — types not defined yet.

- [ ] **Step 3: Create packages/core/src/errors.ts**

```ts
// packages/core/src/errors.ts

export type ErrorCode =
  | "CONFIG_INVALID"
  | "CONFIG_NOT_FOUND"
  | "SECRET_NOT_FOUND"
  | "SECRET_STORE_UNAVAILABLE"
  | "PROVIDER_UNAVAILABLE"
  | "PROVIDER_AUTH_FAILED"
  | "MODEL_NOT_FOUND"
  | "MODEL_CAPABILITY_INSUFFICIENT"
  | "PROJECT_NOT_FOUND"
  | "PROJECT_ALREADY_EXISTS"
  | "STORAGE_READ_ERROR"
  | "STORAGE_WRITE_ERROR"
  | "JOB_NOT_FOUND"
  | "JOB_ALREADY_RUNNING"
  | "JOB_INVALID_STATE"
  | "EVENT_WRITE_ERROR"
  | "UNKNOWN";

export class AppError extends Error {
  readonly code: ErrorCode;
  readonly context?: Record<string, unknown>;

  constructor(code: ErrorCode, message: string, context?: Record<string, unknown>) {
    super(message);
    this.name = "AppError";
    this.code = code;
    this.context = context;
  }
}
```

- [ ] **Step 4: Create packages/core/src/types/config.ts**

```ts
// packages/core/src/types/config.ts

export type Preset = "quality" | "balanced" | "budget" | "local-only";

export type RoleName = "main.author" | "fork.worker" | "fresh.reviewer";

export type RoleModelConfig = {
  model: string;
  fallback_models: string[];
};

export type ProjectRoleConfig = Record<RoleName, RoleModelConfig>;

export type ProviderCredentialConfig = {
  provider: string;
  secretRef: string;
  baseUrl?: string;
  enabled: boolean;
};

export type UserEditableConfig = {
  projectSlug: string;
  repoRoot: string;
  preset: Preset;
  providers: ProviderCredentialConfig[];
  roles: ProjectRoleConfig;
};

export type ResolvedRoleRoute = {
  role: RoleName;
  primaryModel: string;
  fallbackModels: string[];
  resolvedProvider: string;
  systemPromptTuningId: string;
};

export type ResolvedConfig = {
  projectSlug: string;
  repoRoot: string;
  preset: Preset;
  roles: Record<RoleName, ResolvedRoleRoute>;
  providers: Array<{
    provider: string;
    secretRef: string;
    baseUrl?: string;
    enabled: boolean;
    capabilities: import("./provider.js").ModelCapability[];
  }>;
  retrieval: {
    maxParallelReadsPerPage: number;
    maxReadWindowLines: number;
    allowControlledBash: boolean;
  };
};
```

- [ ] **Step 5: Create packages/core/src/types/provider.ts**

```ts
// packages/core/src/types/provider.ts

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
```

- [ ] **Step 6: Create packages/core/src/types/project.ts**

```ts
// packages/core/src/types/project.ts

export type RepoProfile = {
  projectSlug: string;
  repoRoot: string;
  repoName: string;
  branch: string;
  commitHash: string;
  languages: string[];
  frameworks: string[];
  packageManagers: string[];
  entryFiles: string[];
  importantDirs: string[];
  ignoredPaths: string[];
  sourceFileCount: number;
  docFileCount: number;
  treeSummary: string;
  architectureHints: string[];
};

export type ProjectInfo = {
  projectSlug: string;
  repoRoot: string;
  branch: string;
  createdAt: string;
  updatedAt: string;
  latestVersionId?: string;
  repoProfile?: RepoProfile;
};
```

- [ ] **Step 7: Create packages/core/src/types/generation.ts**

```ts
// packages/core/src/types/generation.ts

import type { ResolvedConfig } from "./config.js";

export type JobStatus =
  | "queued"
  | "cataloging"
  | "page_drafting"
  | "reviewing"
  | "validating"
  | "publishing"
  | "completed"
  | "interrupted"
  | "failed";

export type GenerationJob = {
  id: string;
  projectSlug: string;
  repoRoot: string;
  versionId: string;
  status: JobStatus;
  createdAt: string;
  startedAt?: string;
  finishedAt?: string;
  configSnapshot: ResolvedConfig;
  currentPageSlug?: string;
  nextPageOrder?: number;
  lastError?: string;
  summary: {
    totalPages?: number;
    succeededPages?: number;
    failedPages?: number;
  };
};

export type WikiJson = {
  summary: string;
  language?: string;
  reading_order: Array<{
    slug: string;
    title: string;
    rationale: string;
    covered_files: string[];
  }>;
};

export type PageStatus = "drafted" | "reviewed" | "validated" | "published";

export type PageMeta = {
  slug: string;
  title: string;
  order: number;
  sectionId: string;
  coveredFiles: string[];
  relatedPages: string[];
  generatedAt: string;
  commitHash: string;
  citationFile: string;
  summary: string;
  reviewStatus: "accepted" | "accepted_with_notes";
  reviewSummary: string;
  reviewDigest: string;
  status: PageStatus;
  validation: {
    structurePassed: boolean;
    mermaidPassed: boolean;
    citationsPassed: boolean;
    linksPassed: boolean;
    summary: "passed" | "failed";
  };
};

export type CitationKind = "file" | "page" | "commit";

export type CitationRecord = {
  kind: CitationKind;
  target: string;
  locator?: string;
  note?: string;
};
```

- [ ] **Step 8: Create packages/core/src/types/review.ts**

```ts
// packages/core/src/types/review.ts

import type { CitationRecord } from "./generation.js";

export type ReviewBriefing = {
  page_title: string;
  section_position: string;
  current_page_plan: string;
  full_book_summary: string;
  current_draft: string;
  citations: CitationRecord[];
  covered_files: string[];
  review_questions: string[];
};

export type ReviewVerdict = "pass" | "revise";

export type ReviewConclusion = {
  verdict: ReviewVerdict;
  blockers: string[];
  factual_risks: string[];
  missing_evidence: string[];
  scope_violations: string[];
  suggested_revisions: string[];
};
```

- [ ] **Step 9: Create packages/core/src/types/validation.ts**

```ts
// packages/core/src/types/validation.ts

export type ValidationTarget = "wiki" | "page";

export type ValidationReport = {
  target: ValidationTarget;
  passed: boolean;
  errors: string[];
  warnings: string[];
};
```

- [ ] **Step 10: Create packages/core/src/types/events.ts**

```ts
// packages/core/src/types/events.ts

export type EventChannel = "job" | "chat" | "research";

export type AppEvent<T = unknown> = {
  id: string;
  channel: EventChannel;
  type: string;
  at: string;
  projectId: string;
  jobId?: string;
  versionId?: string;
  pageSlug?: string;
  sessionId?: string;
  payload: T;
};

export type AskSession = {
  id: string;
  projectSlug: string;
  versionId: string;
  mode: "ask" | "research";
  currentPageSlug?: string;
  turns: Array<{
    role: "user" | "assistant";
    content: string;
    citations: import("./generation.js").CitationRecord[];
  }>;
  compactSummary?: string;
  updatedAt: string;
};
```

- [ ] **Step 11: Create packages/core/src/types/agent.ts**

```ts
// packages/core/src/types/agent.ts

import type { CitationRecord } from "./generation.js";

export type MainAuthorContext = {
  project_summary: string;
  full_book_summary: string;
  current_page_plan?: string;
  published_page_summaries: Array<{
    slug: string;
    title: string;
    summary: string;
  }>;
  evidence_ledger: Array<{
    id: string;
    kind: "file" | "page" | "commit";
    target: string;
    note: string;
  }>;
};

export type ForkWorkerResult = {
  directive: string;
  findings: string[];
  citations: CitationRecord[];
  open_questions: string[];
};
```

- [ ] **Step 12: Create packages/core/src/types/index.ts**

```ts
// packages/core/src/types/index.ts

export type {
  Preset,
  RoleName,
  RoleModelConfig,
  ProjectRoleConfig,
  ProviderCredentialConfig,
  UserEditableConfig,
  ResolvedRoleRoute,
  ResolvedConfig,
} from "./config.js";

export type {
  ProviderHealth,
  ModelCapability,
  SystemPromptTuningProfile,
} from "./provider.js";

export type { RepoProfile, ProjectInfo } from "./project.js";

export type {
  JobStatus,
  GenerationJob,
  WikiJson,
  PageStatus,
  PageMeta,
  CitationKind,
  CitationRecord,
} from "./generation.js";

export type { ReviewBriefing, ReviewVerdict, ReviewConclusion } from "./review.js";

export type { ValidationTarget, ValidationReport } from "./validation.js";

export type { EventChannel, AppEvent, AskSession } from "./events.js";

export type { MainAuthorContext, ForkWorkerResult } from "./agent.js";
```

- [ ] **Step 13: Create packages/core/src/index.ts**

```ts
// packages/core/src/index.ts

export { AppError } from "./errors.js";
export type { ErrorCode } from "./errors.js";
export * from "./types/index.js";
```

- [ ] **Step 14: Run tests to verify they pass**

Run: `pnpm --filter @reporead/core test`
Expected: PASS — all 5 type smoke tests pass.

- [ ] **Step 15: Run typecheck**

Run: `pnpm --filter @reporead/core typecheck`
Expected: No errors.

- [ ] **Step 16: Commit**

```bash
git add packages/core/src/
git commit -m "feat(B003): core public types and AppError

Define all shared DTOs from design.md: config, provider, project,
generation, review, validation, events, agent types."
```

---

## Task 4: CLI and Web Minimal Shells (B004)

**Files:**
- Create: `packages/cli/src/index.ts`
- Create: `packages/cli/src/cli.tsx`
- Create: `packages/web/src/app/layout.tsx`
- Create: `packages/web/src/app/page.tsx`
- Create: `packages/web/src/app/globals.css`
- Create: `packages/web/next.config.ts`
- Create: `packages/web/tailwind.config.ts`
- Create: `packages/web/postcss.config.mjs`
- Test: `packages/cli/src/__tests__/cli.test.ts`

- [ ] **Step 1: Write CLI smoke test**

```ts
// packages/cli/src/__tests__/cli.test.ts
import { describe, it, expect } from "vitest";
import { createProgram } from "../cli.js";

describe("CLI program", () => {
  it("creates a Commander program with name repo-read", () => {
    const program = createProgram();
    expect(program.name()).toBe("repo-read");
  });

  it("has version defined", () => {
    const program = createProgram();
    expect(program.version()).toBeDefined();
  });

  it("has init command registered", () => {
    const program = createProgram();
    const initCmd = program.commands.find((c) => c.name() === "init");
    expect(initCmd).toBeDefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @reporead/cli test`
Expected: FAIL — cli.ts not found.

- [ ] **Step 3: Create packages/cli/src/cli.tsx**

```tsx
// packages/cli/src/cli.tsx
import { Command } from "commander";

export function createProgram(): Command {
  const program = new Command();

  program
    .name("repo-read")
    .description("Local-first code reading & technical writing workbench")
    .version("0.1.0");

  program
    .command("init")
    .description("Initialize a new RepoRead project in the current directory")
    .action(() => {
      console.log("repo-read init — not yet implemented");
    });

  program
    .command("providers")
    .description("Manage LLM provider credentials and role model mappings")
    .action(() => {
      console.log("repo-read providers — not yet implemented");
    });

  return program;
}
```

- [ ] **Step 4: Create packages/cli/src/index.ts**

```ts
#!/usr/bin/env node
// packages/cli/src/index.ts

import { createProgram } from "./cli.js";

const program = createProgram();
program.parse();
```

- [ ] **Step 5: Run CLI test to verify it passes**

Run: `pnpm --filter @reporead/cli test`
Expected: PASS — all 3 tests pass.

- [ ] **Step 6: Verify CLI runs**

Run: `pnpm --filter @reporead/cli dev -- --help`
Expected: Shows help text with `init` and `providers` commands.

- [ ] **Step 7: Create packages/web/next.config.ts**

```ts
// packages/web/next.config.ts
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: ["@reporead/core"],
};

export default nextConfig;
```

- [ ] **Step 8: Create packages/web/tailwind.config.ts**

```ts
// packages/web/tailwind.config.ts
import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
};

export default config;
```

- [ ] **Step 9: Create packages/web/postcss.config.mjs**

```js
// packages/web/postcss.config.mjs
const config = {
  plugins: {
    "@tailwindcss/postcss": {},
  },
};

export default config;
```

- [ ] **Step 10: Create packages/web/src/app/globals.css**

```css
@import "tailwindcss";
```

- [ ] **Step 11: Create packages/web/src/app/layout.tsx**

```tsx
// packages/web/src/app/layout.tsx
import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "RepoRead",
  description: "Local-first code reading & technical writing workbench",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="bg-white text-gray-900 dark:bg-gray-950 dark:text-gray-100">
        {children}
      </body>
    </html>
  );
}
```

- [ ] **Step 12: Create packages/web/src/app/page.tsx**

```tsx
// packages/web/src/app/page.tsx
export default function HomePage() {
  return (
    <main className="flex min-h-screen items-center justify-center">
      <div className="text-center">
        <h1 className="text-4xl font-bold">RepoRead</h1>
        <p className="mt-2 text-gray-500">
          Local-first code reading &amp; technical writing workbench
        </p>
      </div>
    </main>
  );
}
```

- [ ] **Step 13: Create packages/web/src/lib/core-client.ts**

```ts
// packages/web/src/lib/core-client.ts
// Verify core package is importable from web
import type { UserEditableConfig } from "@reporead/core";

export type { UserEditableConfig };
```

- [ ] **Step 14: Verify web builds**

Run: `pnpm --filter @reporead/web build`
Expected: Next.js build succeeds.

- [ ] **Step 15: Commit**

```bash
git add packages/cli/src/ packages/web/src/ packages/web/next.config.ts packages/web/tailwind.config.ts packages/web/postcss.config.mjs
git commit -m "feat(B004): CLI and Web minimal shells

CLI: Commander.js program with init/providers stubs.
Web: Next.js 15 App Router with Tailwind, imports @reporead/core."
```

---

## Task 5: Config Schema with Zod v4 (B010)

**Files:**
- Create: `packages/core/src/config/schema.ts`
- Create: `packages/core/src/config/index.ts`
- Test: `packages/core/src/config/__tests__/schema.test.ts`

- [ ] **Step 1: Write failing test for config schema**

```ts
// packages/core/src/config/__tests__/schema.test.ts
import { describe, it, expect } from "vitest";
import {
  UserEditableConfigSchema,
  parseUserEditableConfig,
} from "../schema.js";

describe("UserEditableConfigSchema", () => {
  const validConfig = {
    projectSlug: "my-project",
    repoRoot: "/home/user/repo",
    preset: "quality",
    providers: [
      { provider: "anthropic", secretRef: "key-1", enabled: true },
    ],
    roles: {
      "main.author": { model: "claude-opus-4-6", fallback_models: ["claude-sonnet-4-6"] },
      "fork.worker": { model: "claude-sonnet-4-6", fallback_models: [] },
      "fresh.reviewer": { model: "claude-opus-4-6", fallback_models: [] },
    },
  };

  it("accepts valid config", () => {
    const result = parseUserEditableConfig(validConfig);
    expect(result.projectSlug).toBe("my-project");
    expect(result.preset).toBe("quality");
  });

  it("rejects unknown preset", () => {
    expect(() =>
      parseUserEditableConfig({ ...validConfig, preset: "turbo" }),
    ).toThrow();
  });

  it("rejects missing role", () => {
    const bad = {
      ...validConfig,
      roles: {
        "main.author": { model: "x", fallback_models: [] },
        "fork.worker": { model: "x", fallback_models: [] },
        // missing fresh.reviewer
      },
    };
    expect(() => parseUserEditableConfig(bad)).toThrow();
  });

  it("rejects extra fields on role", () => {
    const bad = {
      ...validConfig,
      roles: {
        ...validConfig.roles,
        "main.author": {
          model: "x",
          fallback_models: [],
          customPrompt: "hack",
        },
      },
    };
    expect(() => parseUserEditableConfig(bad)).toThrow();
  });

  it("accepts optional baseUrl on provider", () => {
    const config = {
      ...validConfig,
      providers: [
        { provider: "ollama", secretRef: "", baseUrl: "http://localhost:11434", enabled: true },
      ],
    };
    const result = parseUserEditableConfig(config);
    expect(result.providers[0].baseUrl).toBe("http://localhost:11434");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @reporead/core test -- src/config`
Expected: FAIL — schema.ts not found.

- [ ] **Step 3: Implement config schema**

```ts
// packages/core/src/config/schema.ts
import { z } from "zod/v4";

const RoleModelConfigSchema = z.strictObject({
  model: z.string().min(1),
  fallback_models: z.array(z.string()),
});

const PresetSchema = z.enum(["quality", "balanced", "budget", "local-only"]);

const ProviderCredentialConfigSchema = z.object({
  provider: z.string().min(1),
  secretRef: z.string(),
  baseUrl: z.string().optional(),
  enabled: z.boolean(),
});

const ProjectRoleConfigSchema = z.strictObject({
  "main.author": RoleModelConfigSchema,
  "fork.worker": RoleModelConfigSchema,
  "fresh.reviewer": RoleModelConfigSchema,
});

export const UserEditableConfigSchema = z.object({
  projectSlug: z.string().min(1),
  repoRoot: z.string().min(1),
  preset: PresetSchema,
  providers: z.array(ProviderCredentialConfigSchema).min(1),
  roles: ProjectRoleConfigSchema,
});

export type UserEditableConfigInput = z.input<typeof UserEditableConfigSchema>;

export function parseUserEditableConfig(input: unknown) {
  return UserEditableConfigSchema.parse(input);
}
```

- [ ] **Step 4: Create config index**

```ts
// packages/core/src/config/index.ts
export { UserEditableConfigSchema, parseUserEditableConfig } from "./schema.js";
export type { UserEditableConfigInput } from "./schema.js";
```

- [ ] **Step 5: Update core index to export config**

Add to `packages/core/src/index.ts`:

```ts
export { UserEditableConfigSchema, parseUserEditableConfig } from "./config/index.js";
export type { UserEditableConfigInput } from "./config/index.js";
```

- [ ] **Step 6: Run tests**

Run: `pnpm --filter @reporead/core test -- src/config`
Expected: PASS — all 5 schema tests pass.

- [ ] **Step 7: Commit**

```bash
git add packages/core/src/config/ packages/core/src/index.ts
git commit -m "feat(B010): user-editable config schema with Zod v4

Three roles only, strict object prevents extra fields,
preset enum validated, providers require at least one entry."
```

---

## Task 6: Config Loader and Resolver (B010 continued)

**Files:**
- Create: `packages/core/src/config/loader.ts`
- Create: `packages/core/src/config/resolver.ts`
- Test: `packages/core/src/config/__tests__/loader.test.ts`
- Test: `packages/core/src/config/__tests__/resolver.test.ts`

- [ ] **Step 1: Write failing test for config loader**

```ts
// packages/core/src/config/__tests__/loader.test.ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";
import { loadProjectConfig, CONFIG_FILENAME } from "../loader.js";

describe("loadProjectConfig", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "reporead-test-"));
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it("loads valid config from project.json", async () => {
    const projectDir = path.join(tmpDir, ".reporead", "projects", "test-project");
    await fs.mkdir(projectDir, { recursive: true });
    const config = {
      projectSlug: "test-project",
      repoRoot: "/tmp/repo",
      preset: "quality",
      providers: [{ provider: "anthropic", secretRef: "k", enabled: true }],
      roles: {
        "main.author": { model: "claude-opus-4-6", fallback_models: [] },
        "fork.worker": { model: "claude-sonnet-4-6", fallback_models: [] },
        "fresh.reviewer": { model: "claude-opus-4-6", fallback_models: [] },
      },
    };
    await fs.writeFile(
      path.join(projectDir, CONFIG_FILENAME),
      JSON.stringify(config, null, 2),
    );
    const loaded = await loadProjectConfig(projectDir);
    expect(loaded.projectSlug).toBe("test-project");
  });

  it("throws AppError for missing config", async () => {
    await expect(loadProjectConfig(tmpDir)).rejects.toThrow("CONFIG_NOT_FOUND");
  });

  it("throws AppError for invalid config", async () => {
    const projectDir = path.join(tmpDir, ".reporead", "projects", "bad");
    await fs.mkdir(projectDir, { recursive: true });
    await fs.writeFile(
      path.join(projectDir, CONFIG_FILENAME),
      JSON.stringify({ bad: true }),
    );
    await expect(loadProjectConfig(projectDir)).rejects.toThrow("CONFIG_INVALID");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @reporead/core test -- src/config/__tests__/loader`
Expected: FAIL — loader.ts not found.

- [ ] **Step 3: Implement config loader**

```ts
// packages/core/src/config/loader.ts
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { AppError } from "../errors.js";
import { parseUserEditableConfig } from "./schema.js";
import type { UserEditableConfig } from "../types/config.js";

export const CONFIG_FILENAME = "project.json";

export async function loadProjectConfig(projectDir: string): Promise<UserEditableConfig> {
  const configPath = path.join(projectDir, CONFIG_FILENAME);

  let raw: string;
  try {
    raw = await fs.readFile(configPath, "utf-8");
  } catch {
    throw new AppError("CONFIG_NOT_FOUND", `Config not found at ${configPath}`, {
      path: configPath,
    });
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new AppError("CONFIG_INVALID", `Invalid JSON in ${configPath}`, {
      path: configPath,
    });
  }

  try {
    return parseUserEditableConfig(parsed);
  } catch (err) {
    throw new AppError("CONFIG_INVALID", `Config validation failed: ${String(err)}`, {
      path: configPath,
    });
  }
}

export async function saveProjectConfig(
  projectDir: string,
  config: UserEditableConfig,
): Promise<void> {
  await fs.mkdir(projectDir, { recursive: true });
  const configPath = path.join(projectDir, CONFIG_FILENAME);
  await fs.writeFile(configPath, JSON.stringify(config, null, 2), "utf-8");
}
```

- [ ] **Step 4: Run loader tests**

Run: `pnpm --filter @reporead/core test -- src/config/__tests__/loader`
Expected: PASS.

- [ ] **Step 5: Write failing test for config resolver**

```ts
// packages/core/src/config/__tests__/resolver.test.ts
import { describe, it, expect } from "vitest";
import { resolveConfig } from "../resolver.js";
import type { UserEditableConfig } from "../../types/config.js";
import type { ModelCapability } from "../../types/provider.js";

const baseConfig: UserEditableConfig = {
  projectSlug: "test",
  repoRoot: "/tmp/repo",
  preset: "quality",
  providers: [{ provider: "anthropic", secretRef: "k", enabled: true }],
  roles: {
    "main.author": { model: "claude-opus-4-6", fallback_models: ["claude-sonnet-4-6"] },
    "fork.worker": { model: "claude-sonnet-4-6", fallback_models: [] },
    "fresh.reviewer": { model: "claude-opus-4-6", fallback_models: [] },
  },
};

const capabilities: ModelCapability[] = [
  {
    model: "claude-opus-4-6",
    provider: "anthropic",
    supportsStreaming: true,
    supportsToolCalls: true,
    supportsJsonSchema: true,
    supportsLongContext: true,
    supportsReasoningContent: true,
    isLocalModel: false,
    health: "healthy",
    checkedAt: new Date().toISOString(),
  },
  {
    model: "claude-sonnet-4-6",
    provider: "anthropic",
    supportsStreaming: true,
    supportsToolCalls: true,
    supportsJsonSchema: true,
    supportsLongContext: true,
    supportsReasoningContent: false,
    isLocalModel: false,
    health: "healthy",
    checkedAt: new Date().toISOString(),
  },
];

describe("resolveConfig", () => {
  it("resolves roles with matching capabilities", () => {
    const resolved = resolveConfig(baseConfig, capabilities);
    expect(resolved.roles["main.author"].primaryModel).toBe("claude-opus-4-6");
    expect(resolved.roles["main.author"].resolvedProvider).toBe("anthropic");
  });

  it("includes retrieval defaults for quality preset", () => {
    const resolved = resolveConfig(baseConfig, capabilities);
    expect(resolved.retrieval.maxParallelReadsPerPage).toBe(2);
    expect(resolved.retrieval.allowControlledBash).toBe(true);
  });

  it("restricts retrieval for local-only preset", () => {
    const localConfig = { ...baseConfig, preset: "local-only" as const };
    const resolved = resolveConfig(localConfig, capabilities);
    expect(resolved.retrieval.maxParallelReadsPerPage).toBe(1);
  });

  it("assigns systemPromptTuningId based on model family", () => {
    const resolved = resolveConfig(baseConfig, capabilities);
    expect(resolved.roles["main.author"].systemPromptTuningId).toBe("anthropic-claude");
  });
});
```

- [ ] **Step 6: Run test to verify it fails**

Run: `pnpm --filter @reporead/core test -- src/config/__tests__/resolver`
Expected: FAIL — resolver.ts not found.

- [ ] **Step 7: Implement config resolver**

```ts
// packages/core/src/config/resolver.ts
import type { UserEditableConfig, ResolvedConfig, ResolvedRoleRoute, RoleName } from "../types/config.js";
import type { ModelCapability } from "../types/provider.js";

const PRESET_RETRIEVAL = {
  quality: { maxParallelReadsPerPage: 2, maxReadWindowLines: 300, allowControlledBash: true },
  balanced: { maxParallelReadsPerPage: 2, maxReadWindowLines: 300, allowControlledBash: true },
  budget: { maxParallelReadsPerPage: 2, maxReadWindowLines: 300, allowControlledBash: true },
  "local-only": { maxParallelReadsPerPage: 1, maxReadWindowLines: 300, allowControlledBash: false },
} as const;

export function detectModelFamily(model: string, provider: string): string {
  if (provider === "anthropic" || model.startsWith("claude")) return "anthropic-claude";
  if (provider === "openai" || model.startsWith("gpt") || model.startsWith("o1") || model.startsWith("o3")) return "openai-gpt";
  if (provider === "google" || model.startsWith("gemini")) return "google-gemini";
  return "generic-openai-compatible";
}

function resolveRole(
  roleName: RoleName,
  config: UserEditableConfig,
  capabilities: ModelCapability[],
): ResolvedRoleRoute {
  const roleConfig = config.roles[roleName];
  const primaryModel = roleConfig.model;

  const cap = capabilities.find(
    (c) => c.model === primaryModel && c.health !== "unavailable",
  );
  const resolvedProvider = cap?.provider ?? config.providers[0].provider;
  const family = detectModelFamily(primaryModel, resolvedProvider);

  return {
    role: roleName,
    primaryModel,
    fallbackModels: roleConfig.fallback_models,
    resolvedProvider,
    systemPromptTuningId: family,
  };
}

export function resolveConfig(
  config: UserEditableConfig,
  capabilities: ModelCapability[],
): ResolvedConfig {
  const roles = {
    "main.author": resolveRole("main.author", config, capabilities),
    "fork.worker": resolveRole("fork.worker", config, capabilities),
    "fresh.reviewer": resolveRole("fresh.reviewer", config, capabilities),
  } as Record<RoleName, ResolvedRoleRoute>;

  return {
    projectSlug: config.projectSlug,
    repoRoot: config.repoRoot,
    preset: config.preset,
    roles,
    providers: config.providers.map((p) => ({
      ...p,
      capabilities: capabilities.filter((c) => c.provider === p.provider),
    })),
    retrieval: { ...PRESET_RETRIEVAL[config.preset] },
  };
}
```

- [ ] **Step 8: Update config/index.ts**

```ts
// packages/core/src/config/index.ts
export { UserEditableConfigSchema, parseUserEditableConfig } from "./schema.js";
export type { UserEditableConfigInput } from "./schema.js";
export { loadProjectConfig, saveProjectConfig, CONFIG_FILENAME } from "./loader.js";
export { resolveConfig, detectModelFamily } from "./resolver.js";
```

- [ ] **Step 9: Run all config tests**

Run: `pnpm --filter @reporead/core test -- src/config`
Expected: PASS — all schema, loader, and resolver tests pass.

- [ ] **Step 10: Commit**

```bash
git add packages/core/src/config/
git commit -m "feat(B010): config loader and resolver

Load project.json from .reporead, validate with Zod, resolve
role routes with model family detection and preset-based retrieval."
```

---

## Task 7: Secret Store (B011)

**Files:**
- Create: `packages/core/src/secrets/secret-store.ts`
- Create: `packages/core/src/secrets/index.ts`
- Test: `packages/core/src/secrets/__tests__/secret-store.test.ts`

- [ ] **Step 1: Write failing test for secret store**

```ts
// packages/core/src/secrets/__tests__/secret-store.test.ts
import { describe, it, expect, beforeEach, vi } from "vitest";
import { SecretStore } from "../secret-store.js";

describe("SecretStore", () => {
  describe("env fallback mode", () => {
    let store: SecretStore;

    beforeEach(() => {
      store = new SecretStore({ backend: "env" });
    });

    it("reads from environment variables", async () => {
      process.env["REPOREAD_SECRET_test_key"] = "secret-value";
      const value = await store.get("test_key");
      expect(value).toBe("secret-value");
      delete process.env["REPOREAD_SECRET_test_key"];
    });

    it("returns null for missing secret", async () => {
      const value = await store.get("nonexistent");
      expect(value).toBeNull();
    });

    it("masks secret values", () => {
      expect(SecretStore.mask("sk-1234567890abcdef")).toBe("sk-12••••••••cdef");
    });

    it("masks short values completely", () => {
      expect(SecretStore.mask("abc")).toBe("••••");
    });
  });

  describe("backend detection", () => {
    it("creates store with env backend", () => {
      const store = new SecretStore({ backend: "env" });
      expect(store.backendName).toBe("env");
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @reporead/core test -- src/secrets`
Expected: FAIL — secret-store.ts not found.

- [ ] **Step 3: Implement secret store**

```ts
// packages/core/src/secrets/secret-store.ts
import { AppError } from "../errors.js";

export type SecretBackend = "keychain" | "env";

export interface SecretStoreOptions {
  backend: SecretBackend;
  service?: string;
}

const ENV_PREFIX = "REPOREAD_SECRET_";

export class SecretStore {
  readonly backendName: SecretBackend;
  private readonly service: string;

  constructor(options: SecretStoreOptions) {
    this.backendName = options.backend;
    this.service = options.service ?? "reporead";
  }

  async get(key: string): Promise<string | null> {
    if (this.backendName === "keychain") {
      return this.getFromKeychain(key);
    }
    return this.getFromEnv(key);
  }

  async set(key: string, value: string): Promise<void> {
    if (this.backendName === "keychain") {
      return this.setToKeychain(key, value);
    }
    throw new AppError(
      "SECRET_STORE_UNAVAILABLE",
      "Cannot write secrets in env-only mode. Set the environment variable manually.",
      { key },
    );
  }

  async delete(key: string): Promise<void> {
    if (this.backendName === "keychain") {
      return this.deleteFromKeychain(key);
    }
    throw new AppError(
      "SECRET_STORE_UNAVAILABLE",
      "Cannot delete secrets in env-only mode.",
      { key },
    );
  }

  private getFromEnv(key: string): string | null {
    return process.env[`${ENV_PREFIX}${key}`] ?? null;
  }

  private async getFromKeychain(key: string): Promise<string | null> {
    try {
      const keytar = await import("keytar");
      const value = await keytar.getPassword(this.service, key);
      return value ?? null;
    } catch {
      // Keychain unavailable, fall back to env
      return this.getFromEnv(key);
    }
  }

  private async setToKeychain(key: string, value: string): Promise<void> {
    try {
      const keytar = await import("keytar");
      await keytar.setPassword(this.service, key, value);
    } catch {
      throw new AppError(
        "SECRET_STORE_UNAVAILABLE",
        "System keychain not available. Use environment variables instead.",
        { key },
      );
    }
  }

  private async deleteFromKeychain(key: string): Promise<void> {
    try {
      const keytar = await import("keytar");
      await keytar.deletePassword(this.service, key);
    } catch {
      throw new AppError(
        "SECRET_STORE_UNAVAILABLE",
        "System keychain not available.",
        { key },
      );
    }
  }

  static mask(value: string): string {
    if (value.length <= 8) return "••••";
    const prefix = value.slice(0, 4);
    const suffix = value.slice(-4);
    return `${prefix}${"••••••••"}${suffix}`;
  }

  static async createDefault(): Promise<SecretStore> {
    try {
      await import("keytar");
      return new SecretStore({ backend: "keychain" });
    } catch {
      return new SecretStore({ backend: "env" });
    }
  }
}
```

- [ ] **Step 4: Create secrets/index.ts**

```ts
// packages/core/src/secrets/index.ts
export { SecretStore } from "./secret-store.js";
export type { SecretBackend, SecretStoreOptions } from "./secret-store.js";
```

- [ ] **Step 5: Update core index.ts**

Add to `packages/core/src/index.ts`:

```ts
export { SecretStore } from "./secrets/index.js";
export type { SecretBackend, SecretStoreOptions } from "./secrets/index.js";
```

- [ ] **Step 6: Run tests**

Run: `pnpm --filter @reporead/core test -- src/secrets`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/core/src/secrets/ packages/core/src/index.ts
git commit -m "feat(B011): secret store with keychain + env fallback

Keytar-based keychain access with lazy import. Falls back to
REPOREAD_SECRET_* env vars. Includes masking utility."
```

---

## Task 8: Provider Interface and Capability Detection (B012)

**Files:**
- Create: `packages/core/src/providers/provider-interface.ts`
- Create: `packages/core/src/providers/capability.ts`
- Create: `packages/core/src/providers/index.ts`
- Test: `packages/core/src/providers/__tests__/capability.test.ts`

- [ ] **Step 1: Write failing test for capability**

```ts
// packages/core/src/providers/__tests__/capability.test.ts
import { describe, it, expect } from "vitest";
import { getStaticCapabilities, KNOWN_MODELS } from "../capability.js";

describe("getStaticCapabilities", () => {
  it("returns capabilities for known Anthropic model", () => {
    const cap = getStaticCapabilities("claude-opus-4-6", "anthropic");
    expect(cap.supportsStreaming).toBe(true);
    expect(cap.supportsToolCalls).toBe(true);
    expect(cap.supportsJsonSchema).toBe(true);
    expect(cap.supportsLongContext).toBe(true);
    expect(cap.health).toBe("healthy");
  });

  it("returns capabilities for known OpenAI model", () => {
    const cap = getStaticCapabilities("gpt-4o", "openai");
    expect(cap.supportsStreaming).toBe(true);
    expect(cap.supportsToolCalls).toBe(true);
  });

  it("returns degraded for unknown model", () => {
    const cap = getStaticCapabilities("unknown-model-v1", "openai-compatible");
    expect(cap.health).toBe("degraded");
    expect(cap.supportsStreaming).toBe(true);
    expect(cap.supportsToolCalls).toBe(false);
  });

  it("marks local models correctly", () => {
    const cap = getStaticCapabilities("llama3", "openai-compatible");
    expect(cap.isLocalModel).toBe(true);
  });

  it("KNOWN_MODELS has entries for supported providers", () => {
    expect(KNOWN_MODELS.size).toBeGreaterThanOrEqual(4);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @reporead/core test -- src/providers/__tests__/capability`
Expected: FAIL — module not found.

- [ ] **Step 3: Create provider interface**

```ts
// packages/core/src/providers/provider-interface.ts
export interface ProviderAdapter {
  readonly providerId: string;
  readonly displayName: string;

  /**
   * Test connection and return true if auth is valid.
   */
  probe(apiKey: string, baseUrl?: string): Promise<boolean>;
}
```

- [ ] **Step 4: Implement static capability table**

```ts
// packages/core/src/providers/capability.ts
import type { ModelCapability } from "../types/provider.js";

type StaticModelEntry = Omit<ModelCapability, "checkedAt" | "health"> & {
  health?: ModelCapability["health"];
};

export const KNOWN_MODELS: Map<string, StaticModelEntry> = new Map([
  // Anthropic
  ["claude-opus-4-6", {
    model: "claude-opus-4-6", provider: "anthropic",
    supportsStreaming: true, supportsToolCalls: true,
    supportsJsonSchema: true, supportsLongContext: true,
    supportsReasoningContent: true, isLocalModel: false,
  }],
  ["claude-sonnet-4-6", {
    model: "claude-sonnet-4-6", provider: "anthropic",
    supportsStreaming: true, supportsToolCalls: true,
    supportsJsonSchema: true, supportsLongContext: true,
    supportsReasoningContent: false, isLocalModel: false,
  }],
  ["claude-haiku-4-5-20251001", {
    model: "claude-haiku-4-5-20251001", provider: "anthropic",
    supportsStreaming: true, supportsToolCalls: true,
    supportsJsonSchema: true, supportsLongContext: true,
    supportsReasoningContent: false, isLocalModel: false,
  }],
  // OpenAI
  ["gpt-4o", {
    model: "gpt-4o", provider: "openai",
    supportsStreaming: true, supportsToolCalls: true,
    supportsJsonSchema: true, supportsLongContext: true,
    supportsReasoningContent: false, isLocalModel: false,
  }],
  ["gpt-4o-mini", {
    model: "gpt-4o-mini", provider: "openai",
    supportsStreaming: true, supportsToolCalls: true,
    supportsJsonSchema: true, supportsLongContext: true,
    supportsReasoningContent: false, isLocalModel: false,
  }],
]);

export function getStaticCapabilities(
  model: string,
  provider: string,
): ModelCapability {
  const known = KNOWN_MODELS.get(model);
  if (known) {
    return {
      ...known,
      health: known.health ?? "healthy",
      checkedAt: new Date().toISOString(),
    };
  }

  // Unknown model: assume openai-compatible with minimal capabilities
  const isLocal = provider === "openai-compatible" || provider === "ollama";
  return {
    model,
    provider,
    supportsStreaming: true,
    supportsToolCalls: false,
    supportsJsonSchema: false,
    supportsLongContext: false,
    supportsReasoningContent: false,
    isLocalModel: isLocal,
    health: "degraded",
    checkedAt: new Date().toISOString(),
  };
}
```

- [ ] **Step 5: Create providers/index.ts**

```ts
// packages/core/src/providers/index.ts
export type { ProviderAdapter } from "./provider-interface.js";
export { getStaticCapabilities, KNOWN_MODELS } from "./capability.js";
```

- [ ] **Step 6: Run tests**

Run: `pnpm --filter @reporead/core test -- src/providers/__tests__/capability`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/core/src/providers/
git commit -m "feat(B012): provider interface and static capability table

Known models for Anthropic and OpenAI with capability flags.
Unknown models default to degraded with minimal capabilities."
```

---

## Task 9: Model Route and Provider Center (B013 + B014)

**Files:**
- Create: `packages/core/src/providers/model-route.ts`
- Create: `packages/core/src/providers/provider-center.ts`
- Test: `packages/core/src/providers/__tests__/model-route.test.ts`
- Test: `packages/core/src/providers/__tests__/provider-center.test.ts`

- [ ] **Step 1: Write failing test for model route**

```ts
// packages/core/src/providers/__tests__/model-route.test.ts
import { describe, it, expect } from "vitest";
import { buildFallbackChain } from "../model-route.js";
import type { ModelCapability } from "../../types/provider.js";

const healthy = (model: string, provider: string): ModelCapability => ({
  model, provider,
  supportsStreaming: true, supportsToolCalls: true,
  supportsJsonSchema: true, supportsLongContext: true,
  supportsReasoningContent: false, isLocalModel: false,
  health: "healthy", checkedAt: new Date().toISOString(),
});

const unavailable = (model: string, provider: string): ModelCapability => ({
  ...healthy(model, provider),
  health: "unavailable",
});

describe("buildFallbackChain", () => {
  it("returns primary model first when healthy", () => {
    const chain = buildFallbackChain(
      "claude-opus-4-6",
      ["claude-sonnet-4-6"],
      [healthy("claude-opus-4-6", "anthropic"), healthy("claude-sonnet-4-6", "anthropic")],
    );
    expect(chain[0]).toBe("claude-opus-4-6");
    expect(chain[1]).toBe("claude-sonnet-4-6");
  });

  it("skips unavailable primary", () => {
    const chain = buildFallbackChain(
      "claude-opus-4-6",
      ["claude-sonnet-4-6"],
      [unavailable("claude-opus-4-6", "anthropic"), healthy("claude-sonnet-4-6", "anthropic")],
    );
    expect(chain[0]).toBe("claude-sonnet-4-6");
    expect(chain).not.toContain("claude-opus-4-6");
  });

  it("returns empty chain when all unavailable", () => {
    const chain = buildFallbackChain(
      "claude-opus-4-6",
      [],
      [unavailable("claude-opus-4-6", "anthropic")],
    );
    expect(chain).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @reporead/core test -- src/providers/__tests__/model-route`
Expected: FAIL.

- [ ] **Step 3: Implement model route**

```ts
// packages/core/src/providers/model-route.ts
import type { ModelCapability } from "../types/provider.js";

export function buildFallbackChain(
  primaryModel: string,
  fallbackModels: string[],
  capabilities: ModelCapability[],
): string[] {
  const allCandidates = [primaryModel, ...fallbackModels];
  return allCandidates.filter((model) => {
    const cap = capabilities.find((c) => c.model === model);
    return cap ? cap.health !== "unavailable" : false;
  });
}
```

- [ ] **Step 4: Run model-route tests**

Run: `pnpm --filter @reporead/core test -- src/providers/__tests__/model-route`
Expected: PASS.

- [ ] **Step 5: Write failing test for provider center**

```ts
// packages/core/src/providers/__tests__/provider-center.test.ts
import { describe, it, expect } from "vitest";
import { ProviderCenter } from "../provider-center.js";
import type { UserEditableConfig } from "../../types/config.js";

const testConfig: UserEditableConfig = {
  projectSlug: "test",
  repoRoot: "/tmp",
  preset: "quality",
  providers: [{ provider: "anthropic", secretRef: "k", enabled: true }],
  roles: {
    "main.author": { model: "claude-opus-4-6", fallback_models: ["claude-sonnet-4-6"] },
    "fork.worker": { model: "claude-sonnet-4-6", fallback_models: [] },
    "fresh.reviewer": { model: "claude-opus-4-6", fallback_models: [] },
  },
};

describe("ProviderCenter", () => {
  it("resolves config with static capabilities", () => {
    const center = new ProviderCenter();
    const resolved = center.resolve(testConfig);
    expect(resolved.roles["main.author"].primaryModel).toBe("claude-opus-4-6");
    expect(resolved.roles["main.author"].systemPromptTuningId).toBe("anthropic-claude");
  });

  it("generates a human-readable routing summary", () => {
    const center = new ProviderCenter();
    const summary = center.summarize(testConfig);
    expect(summary).toContain("main.author");
    expect(summary).toContain("claude-opus-4-6");
  });
});
```

- [ ] **Step 6: Run test to verify it fails**

Run: `pnpm --filter @reporead/core test -- src/providers/__tests__/provider-center`
Expected: FAIL.

- [ ] **Step 7: Implement provider center**

```ts
// packages/core/src/providers/provider-center.ts
import type { UserEditableConfig, ResolvedConfig, RoleName } from "../types/config.js";
import type { ModelCapability } from "../types/provider.js";
import { getStaticCapabilities } from "./capability.js";
import { resolveConfig } from "../config/resolver.js";

export class ProviderCenter {
  private capabilityCache: Map<string, ModelCapability> = new Map();

  resolve(config: UserEditableConfig): ResolvedConfig {
    const capabilities = this.gatherCapabilities(config);
    return resolveConfig(config, capabilities);
  }

  summarize(config: UserEditableConfig): string {
    const resolved = this.resolve(config);
    const lines: string[] = ["=== Role Routing Summary ===", ""];

    for (const roleName of ["main.author", "fork.worker", "fresh.reviewer"] as RoleName[]) {
      const route = resolved.roles[roleName];
      lines.push(`${roleName}:`);
      lines.push(`  Primary: ${route.primaryModel} (${route.resolvedProvider})`);
      lines.push(`  Family:  ${route.systemPromptTuningId}`);
      if (route.fallbackModels.length > 0) {
        lines.push(`  Fallback: ${route.fallbackModels.join(", ")}`);
      }
      lines.push("");
    }

    lines.push(`Preset: ${resolved.preset}`);
    lines.push(`Retrieval: max ${resolved.retrieval.maxParallelReadsPerPage} parallel, ${resolved.retrieval.maxReadWindowLines} lines/window`);

    return lines.join("\n");
  }

  private gatherCapabilities(config: UserEditableConfig): ModelCapability[] {
    const models = new Set<string>();
    for (const role of Object.values(config.roles)) {
      models.add(role.model);
      role.fallback_models.forEach((m) => models.add(m));
    }

    const capabilities: ModelCapability[] = [];
    for (const model of models) {
      const cached = this.capabilityCache.get(model);
      if (cached) {
        capabilities.push(cached);
        continue;
      }
      const provider = this.detectProvider(model, config);
      const cap = getStaticCapabilities(model, provider);
      this.capabilityCache.set(model, cap);
      capabilities.push(cap);
    }

    return capabilities;
  }

  private detectProvider(model: string, config: UserEditableConfig): string {
    if (model.startsWith("claude")) return "anthropic";
    if (model.startsWith("gpt") || model.startsWith("o1") || model.startsWith("o3")) return "openai";
    if (model.startsWith("gemini")) return "google";
    return config.providers[0]?.provider ?? "openai-compatible";
  }
}
```

- [ ] **Step 8: Update providers/index.ts**

```ts
// packages/core/src/providers/index.ts
export type { ProviderAdapter } from "./provider-interface.js";
export { getStaticCapabilities, KNOWN_MODELS } from "./capability.js";
export { buildFallbackChain } from "./model-route.js";
export { ProviderCenter } from "./provider-center.js";
```

- [ ] **Step 9: Update core index.ts**

Add to `packages/core/src/index.ts`:

```ts
export { loadProjectConfig, saveProjectConfig, parseUserEditableConfig, resolveConfig } from "./config/index.js";
export { SecretStore } from "./secrets/index.js";
export { ProviderCenter, getStaticCapabilities, buildFallbackChain } from "./providers/index.js";
```

- [ ] **Step 10: Run all provider tests**

Run: `pnpm --filter @reporead/core test -- src/providers`
Expected: PASS.

- [ ] **Step 11: Commit**

```bash
git add packages/core/src/providers/ packages/core/src/index.ts
git commit -m "feat(B013+B014): model routing, fallback chain, ProviderCenter

buildFallbackChain filters unavailable models.
ProviderCenter resolves config with static capabilities,
generates human-readable routing summaries."
```

---

## Task 10: Storage Adapter and Path Builders (B020)

**Files:**
- Create: `packages/core/src/storage/paths.ts`
- Create: `packages/core/src/storage/storage-adapter.ts`
- Create: `packages/core/src/storage/index.ts`
- Test: `packages/core/src/storage/__tests__/paths.test.ts`
- Test: `packages/core/src/storage/__tests__/storage-adapter.test.ts`

- [ ] **Step 1: Write failing test for paths**

```ts
// packages/core/src/storage/__tests__/paths.test.ts
import { describe, it, expect } from "vitest";
import { StoragePaths } from "../paths.js";

describe("StoragePaths", () => {
  const paths = new StoragePaths("/home/user/repo");

  it("root is .reporead under repo root", () => {
    expect(paths.root).toBe("/home/user/repo/.reporead");
  });

  it("currentJson points to current.json", () => {
    expect(paths.currentJson).toBe("/home/user/repo/.reporead/current.json");
  });

  it("projectDir builds project path", () => {
    expect(paths.projectDir("my-project")).toBe(
      "/home/user/repo/.reporead/projects/my-project",
    );
  });

  it("projectJson builds project.json path", () => {
    expect(paths.projectJson("my-project")).toBe(
      "/home/user/repo/.reporead/projects/my-project/project.json",
    );
  });

  it("jobDir builds job directory", () => {
    expect(paths.jobDir("proj", "job-1")).toBe(
      "/home/user/repo/.reporead/projects/proj/jobs/job-1",
    );
  });

  it("jobStateJson builds job-state.json path", () => {
    expect(paths.jobStateJson("proj", "job-1")).toBe(
      "/home/user/repo/.reporead/projects/proj/jobs/job-1/job-state.json",
    );
  });

  it("draftDir builds draft version path", () => {
    expect(paths.draftDir("proj", "job-1", "v1")).toBe(
      "/home/user/repo/.reporead/projects/proj/jobs/job-1/draft/v1",
    );
  });

  it("versionDir builds published version path", () => {
    expect(paths.versionDir("proj", "v1")).toBe(
      "/home/user/repo/.reporead/projects/proj/versions/v1",
    );
  });

  it("reviewJson builds review result path", () => {
    expect(paths.reviewJson("proj", "job-1", "intro")).toBe(
      "/home/user/repo/.reporead/projects/proj/jobs/job-1/review/intro.review.json",
    );
  });

  it("validationJson builds validation result path", () => {
    expect(paths.validationJson("proj", "job-1", "intro")).toBe(
      "/home/user/repo/.reporead/projects/proj/jobs/job-1/validation/intro.validation.json",
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @reporead/core test -- src/storage/__tests__/paths`
Expected: FAIL.

- [ ] **Step 3: Implement StoragePaths**

```ts
// packages/core/src/storage/paths.ts
import * as path from "node:path";

const REPOREAD_DIR = ".reporead";

export class StoragePaths {
  readonly root: string;

  constructor(repoRoot: string) {
    this.root = path.join(repoRoot, REPOREAD_DIR);
  }

  get currentJson(): string {
    return path.join(this.root, "current.json");
  }

  projectDir(slug: string): string {
    return path.join(this.root, "projects", slug);
  }

  projectJson(slug: string): string {
    return path.join(this.projectDir(slug), "project.json");
  }

  jobDir(slug: string, jobId: string): string {
    return path.join(this.projectDir(slug), "jobs", jobId);
  }

  jobStateJson(slug: string, jobId: string): string {
    return path.join(this.jobDir(slug, jobId), "job-state.json");
  }

  eventsNdjson(slug: string, jobId: string): string {
    return path.join(this.jobDir(slug, jobId), "events.ndjson");
  }

  draftDir(slug: string, jobId: string, versionId: string): string {
    return path.join(this.jobDir(slug, jobId), "draft", versionId);
  }

  draftWikiJson(slug: string, jobId: string, versionId: string): string {
    return path.join(this.draftDir(slug, jobId, versionId), "wiki.json");
  }

  draftPageMd(slug: string, jobId: string, versionId: string, pageSlug: string): string {
    return path.join(this.draftDir(slug, jobId, versionId), "pages", `${pageSlug}.md`);
  }

  draftPageMeta(slug: string, jobId: string, versionId: string, pageSlug: string): string {
    return path.join(this.draftDir(slug, jobId, versionId), "pages", `${pageSlug}.meta.json`);
  }

  reviewJson(slug: string, jobId: string, pageSlug: string): string {
    return path.join(this.jobDir(slug, jobId), "review", `${pageSlug}.review.json`);
  }

  validationJson(slug: string, jobId: string, pageSlug: string): string {
    return path.join(this.jobDir(slug, jobId), "validation", `${pageSlug}.validation.json`);
  }

  versionDir(slug: string, versionId: string): string {
    return path.join(this.projectDir(slug), "versions", versionId);
  }

  versionWikiJson(slug: string, versionId: string): string {
    return path.join(this.versionDir(slug, versionId), "wiki.json");
  }

  versionPageMd(slug: string, versionId: string, pageSlug: string): string {
    return path.join(this.versionDir(slug, versionId), "pages", `${pageSlug}.md`);
  }

  versionPageMeta(slug: string, versionId: string, pageSlug: string): string {
    return path.join(this.versionDir(slug, versionId), "pages", `${pageSlug}.meta.json`);
  }
}
```

- [ ] **Step 4: Run path tests**

Run: `pnpm --filter @reporead/core test -- src/storage/__tests__/paths`
Expected: PASS.

- [ ] **Step 5: Write failing test for storage adapter**

```ts
// packages/core/src/storage/__tests__/storage-adapter.test.ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";
import { StorageAdapter } from "../storage-adapter.js";

describe("StorageAdapter", () => {
  let tmpDir: string;
  let adapter: StorageAdapter;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "reporead-storage-"));
    adapter = new StorageAdapter(tmpDir);
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it("initializes .reporead directory structure", async () => {
    await adapter.initialize();
    const stat = await fs.stat(path.join(tmpDir, ".reporead"));
    expect(stat.isDirectory()).toBe(true);
  });

  it("writes and reads JSON", async () => {
    await adapter.initialize();
    const data = { key: "value" };
    await adapter.writeJson(adapter.paths.currentJson, data);
    const read = await adapter.readJson<typeof data>(adapter.paths.currentJson);
    expect(read).toEqual(data);
  });

  it("returns null for missing file", async () => {
    await adapter.initialize();
    const read = await adapter.readJson("/nonexistent.json");
    expect(read).toBeNull();
  });

  it("ensures parent directories when writing", async () => {
    await adapter.initialize();
    const deep = path.join(adapter.paths.root, "projects", "test", "nested.json");
    await adapter.writeJson(deep, { ok: true });
    const read = await adapter.readJson<{ ok: boolean }>(deep);
    expect(read?.ok).toBe(true);
  });
});
```

- [ ] **Step 6: Run test to verify it fails**

Run: `pnpm --filter @reporead/core test -- src/storage/__tests__/storage-adapter`
Expected: FAIL.

- [ ] **Step 7: Implement StorageAdapter**

```ts
// packages/core/src/storage/storage-adapter.ts
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { AppError } from "../errors.js";
import { StoragePaths } from "./paths.js";

export class StorageAdapter {
  readonly paths: StoragePaths;

  constructor(repoRoot: string) {
    this.paths = new StoragePaths(repoRoot);
  }

  async initialize(): Promise<void> {
    await fs.mkdir(this.paths.root, { recursive: true });
  }

  async readJson<T>(filePath: string): Promise<T | null> {
    try {
      const raw = await fs.readFile(filePath, "utf-8");
      return JSON.parse(raw) as T;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") {
        return null;
      }
      throw new AppError("STORAGE_READ_ERROR", `Failed to read ${filePath}`, {
        path: filePath,
        error: String(err),
      });
    }
  }

  async writeJson(filePath: string, data: unknown): Promise<void> {
    try {
      await fs.mkdir(path.dirname(filePath), { recursive: true });
      await fs.writeFile(filePath, JSON.stringify(data, null, 2), "utf-8");
    } catch (err) {
      throw new AppError("STORAGE_WRITE_ERROR", `Failed to write ${filePath}`, {
        path: filePath,
        error: String(err),
      });
    }
  }

  async appendLine(filePath: string, line: string): Promise<void> {
    try {
      await fs.mkdir(path.dirname(filePath), { recursive: true });
      await fs.appendFile(filePath, line + "\n", "utf-8");
    } catch (err) {
      throw new AppError("STORAGE_WRITE_ERROR", `Failed to append to ${filePath}`, {
        path: filePath,
        error: String(err),
      });
    }
  }

  async exists(filePath: string): Promise<boolean> {
    try {
      await fs.access(filePath);
      return true;
    } catch {
      return false;
    }
  }

  async promoteVersion(
    projectSlug: string,
    jobId: string,
    versionId: string,
  ): Promise<void> {
    const draftPath = this.paths.draftDir(projectSlug, jobId, versionId);
    const versionPath = this.paths.versionDir(projectSlug, versionId);

    try {
      await fs.mkdir(path.dirname(versionPath), { recursive: true });
      await fs.rename(draftPath, versionPath);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "EXDEV") {
        await fs.cp(draftPath, versionPath, { recursive: true });
        await fs.rm(draftPath, { recursive: true, force: true });
      } else {
        throw new AppError("STORAGE_WRITE_ERROR", `Failed to promote version ${versionId}`, {
          error: String(err),
        });
      }
    }
  }
}
```

- [ ] **Step 8: Create storage/index.ts**

```ts
// packages/core/src/storage/index.ts
export { StoragePaths } from "./paths.js";
export { StorageAdapter } from "./storage-adapter.js";
```

- [ ] **Step 9: Update core index.ts**

Add to `packages/core/src/index.ts`:

```ts
export { StoragePaths, StorageAdapter } from "./storage/index.js";
```

- [ ] **Step 10: Run all storage tests**

Run: `pnpm --filter @reporead/core test -- src/storage`
Expected: PASS.

- [ ] **Step 11: Commit**

```bash
git add packages/core/src/storage/ packages/core/src/index.ts
git commit -m "feat(B020): storage adapter and path builders

StoragePaths builds all .reporead/* paths. StorageAdapter handles
JSON read/write, ndjson append, directory init, and atomic
version promotion with EXDEV fallback."
```

---

## Task 11: Project Model (B021)

**Files:**
- Create: `packages/core/src/project/project-model.ts`
- Create: `packages/core/src/project/index.ts`
- Test: `packages/core/src/project/__tests__/project-model.test.ts`

- [ ] **Step 1: Write failing test**

```ts
// packages/core/src/project/__tests__/project-model.test.ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";
import { ProjectModel } from "../project-model.js";
import { StorageAdapter } from "../../storage/storage-adapter.js";

describe("ProjectModel", () => {
  let tmpDir: string;
  let storage: StorageAdapter;
  let model: ProjectModel;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "reporead-project-"));
    storage = new StorageAdapter(tmpDir);
    await storage.initialize();
    model = new ProjectModel(storage);
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it("creates a new project", async () => {
    const project = await model.create({
      projectSlug: "test-project",
      repoRoot: tmpDir,
      branch: "main",
    });
    expect(project.projectSlug).toBe("test-project");
    expect(project.createdAt).toBeDefined();
  });

  it("reads a created project", async () => {
    await model.create({ projectSlug: "read-test", repoRoot: tmpDir, branch: "main" });
    const project = await model.get("read-test");
    expect(project).not.toBeNull();
    expect(project!.repoRoot).toBe(tmpDir);
  });

  it("returns null for nonexistent project", async () => {
    const project = await model.get("nonexistent");
    expect(project).toBeNull();
  });

  it("lists all projects", async () => {
    await model.create({ projectSlug: "proj-a", repoRoot: tmpDir, branch: "main" });
    await model.create({ projectSlug: "proj-b", repoRoot: tmpDir, branch: "dev" });
    const list = await model.list();
    expect(list).toHaveLength(2);
  });

  it("rejects duplicate project slug", async () => {
    await model.create({ projectSlug: "dup", repoRoot: tmpDir, branch: "main" });
    await expect(
      model.create({ projectSlug: "dup", repoRoot: tmpDir, branch: "main" }),
    ).rejects.toThrow("PROJECT_ALREADY_EXISTS");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @reporead/core test -- src/project`
Expected: FAIL.

- [ ] **Step 3: Implement ProjectModel**

```ts
// packages/core/src/project/project-model.ts
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { AppError } from "../errors.js";
import type { StorageAdapter } from "../storage/storage-adapter.js";
import type { ProjectInfo } from "../types/project.js";

export interface CreateProjectInput {
  projectSlug: string;
  repoRoot: string;
  branch: string;
}

export class ProjectModel {
  constructor(private readonly storage: StorageAdapter) {}

  async create(input: CreateProjectInput): Promise<ProjectInfo> {
    const existing = await this.get(input.projectSlug);
    if (existing) {
      throw new AppError("PROJECT_ALREADY_EXISTS", `Project "${input.projectSlug}" already exists`);
    }

    const now = new Date().toISOString();
    const project: ProjectInfo = {
      projectSlug: input.projectSlug,
      repoRoot: input.repoRoot,
      branch: input.branch,
      createdAt: now,
      updatedAt: now,
    };

    await this.storage.writeJson(
      this.storage.paths.projectJson(input.projectSlug),
      project,
    );

    return project;
  }

  async get(slug: string): Promise<ProjectInfo | null> {
    return this.storage.readJson<ProjectInfo>(
      this.storage.paths.projectJson(slug),
    );
  }

  async update(slug: string, updates: Partial<Pick<ProjectInfo, "latestVersionId" | "repoProfile">>): Promise<ProjectInfo> {
    const project = await this.get(slug);
    if (!project) {
      throw new AppError("PROJECT_NOT_FOUND", `Project "${slug}" not found`);
    }
    const updated: ProjectInfo = {
      ...project,
      ...updates,
      updatedAt: new Date().toISOString(),
    };
    await this.storage.writeJson(this.storage.paths.projectJson(slug), updated);
    return updated;
  }

  async list(): Promise<ProjectInfo[]> {
    const projectsDir = path.join(this.storage.paths.root, "projects");
    let entries: string[];
    try {
      entries = await fs.readdir(projectsDir);
    } catch {
      return [];
    }

    const projects: ProjectInfo[] = [];
    for (const entry of entries) {
      const project = await this.get(entry);
      if (project) projects.push(project);
    }
    return projects;
  }
}
```

- [ ] **Step 4: Create project/index.ts**

```ts
// packages/core/src/project/index.ts
export { ProjectModel } from "./project-model.js";
export type { CreateProjectInput } from "./project-model.js";
```

- [ ] **Step 5: Update core index.ts**

Add:

```ts
export { ProjectModel } from "./project/index.js";
export type { CreateProjectInput } from "./project/index.js";
```

- [ ] **Step 6: Run tests**

Run: `pnpm --filter @reporead/core test -- src/project`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/core/src/project/ packages/core/src/index.ts
git commit -m "feat(B021): project model with CRUD and listing

Create, get, update, list projects in .reporead/projects/.
Duplicate slug detection, auto-timestamps."
```

---

## Task 12: Events System (B022)

**Files:**
- Create: `packages/core/src/events/app-event.ts`
- Create: `packages/core/src/events/event-writer.ts`
- Create: `packages/core/src/events/event-reader.ts`
- Create: `packages/core/src/events/index.ts`
- Test: `packages/core/src/events/__tests__/event-writer.test.ts`
- Test: `packages/core/src/events/__tests__/event-reader.test.ts`

- [ ] **Step 1: Write failing test for event writer**

```ts
// packages/core/src/events/__tests__/event-writer.test.ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";
import { EventWriter } from "../event-writer.js";
import { createAppEvent } from "../app-event.js";

describe("EventWriter", () => {
  let tmpDir: string;
  let filePath: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "reporead-events-"));
    filePath = path.join(tmpDir, "events.ndjson");
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it("writes an event as ndjson line", async () => {
    const writer = new EventWriter(filePath);
    const event = createAppEvent("job", "job.started", "proj-1", { jobId: "j1" });
    await writer.write(event);

    const content = await fs.readFile(filePath, "utf-8");
    const parsed = JSON.parse(content.trim());
    expect(parsed.type).toBe("job.started");
    expect(parsed.payload.jobId).toBe("j1");
  });

  it("appends multiple events on separate lines", async () => {
    const writer = new EventWriter(filePath);
    await writer.write(createAppEvent("job", "job.started", "p1", {}));
    await writer.write(createAppEvent("job", "catalog.completed", "p1", {}));

    const content = await fs.readFile(filePath, "utf-8");
    const lines = content.trim().split("\n");
    expect(lines).toHaveLength(2);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @reporead/core test -- src/events/__tests__/event-writer`
Expected: FAIL.

- [ ] **Step 3: Create app-event factory**

```ts
// packages/core/src/events/app-event.ts
import { randomUUID } from "node:crypto";
import type { AppEvent, EventChannel } from "../types/events.js";

export function createAppEvent<T = unknown>(
  channel: EventChannel,
  type: string,
  projectId: string,
  payload: T,
  extra?: Partial<Pick<AppEvent, "jobId" | "versionId" | "pageSlug" | "sessionId">>,
): AppEvent<T> {
  return {
    id: randomUUID(),
    channel,
    type,
    at: new Date().toISOString(),
    projectId,
    ...extra,
    payload,
  };
}
```

- [ ] **Step 4: Implement EventWriter**

```ts
// packages/core/src/events/event-writer.ts
import * as fs from "node:fs/promises";
import * as path from "node:path";
import type { AppEvent } from "../types/events.js";

export class EventWriter {
  constructor(private readonly filePath: string) {}

  async write(event: AppEvent): Promise<void> {
    await fs.mkdir(path.dirname(this.filePath), { recursive: true });
    const line = JSON.stringify(event) + "\n";
    await fs.appendFile(this.filePath, line, "utf-8");
  }
}
```

- [ ] **Step 5: Run event-writer tests**

Run: `pnpm --filter @reporead/core test -- src/events/__tests__/event-writer`
Expected: PASS.

- [ ] **Step 6: Write failing test for event reader**

```ts
// packages/core/src/events/__tests__/event-reader.test.ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";
import { EventWriter } from "../event-writer.js";
import { EventReader } from "../event-reader.js";
import { createAppEvent } from "../app-event.js";

describe("EventReader", () => {
  let tmpDir: string;
  let filePath: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "reporead-events-"));
    filePath = path.join(tmpDir, "events.ndjson");
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it("reads all events from ndjson", async () => {
    const writer = new EventWriter(filePath);
    await writer.write(createAppEvent("job", "job.started", "p1", { a: 1 }));
    await writer.write(createAppEvent("job", "catalog.completed", "p1", { b: 2 }));

    const reader = new EventReader(filePath);
    const events = await reader.readAll();
    expect(events).toHaveLength(2);
    expect(events[0].type).toBe("job.started");
    expect(events[1].type).toBe("catalog.completed");
  });

  it("reads events after a given event ID", async () => {
    const writer = new EventWriter(filePath);
    const e1 = createAppEvent("job", "job.started", "p1", {});
    const e2 = createAppEvent("job", "catalog.completed", "p1", {});
    await writer.write(e1);
    await writer.write(e2);

    const reader = new EventReader(filePath);
    const events = await reader.readSince(e1.id);
    expect(events).toHaveLength(1);
    expect(events[0].id).toBe(e2.id);
  });

  it("returns empty array for nonexistent file", async () => {
    const reader = new EventReader("/nonexistent.ndjson");
    const events = await reader.readAll();
    expect(events).toHaveLength(0);
  });
});
```

- [ ] **Step 7: Run test to verify it fails**

Run: `pnpm --filter @reporead/core test -- src/events/__tests__/event-reader`
Expected: FAIL.

- [ ] **Step 8: Implement EventReader**

```ts
// packages/core/src/events/event-reader.ts
import * as fs from "node:fs/promises";
import type { AppEvent } from "../types/events.js";

export class EventReader {
  constructor(private readonly filePath: string) {}

  async readAll(): Promise<AppEvent[]> {
    let content: string;
    try {
      content = await fs.readFile(this.filePath, "utf-8");
    } catch {
      return [];
    }

    return content
      .trim()
      .split("\n")
      .filter((line) => line.length > 0)
      .map((line) => JSON.parse(line) as AppEvent);
  }

  async readSince(afterEventId: string): Promise<AppEvent[]> {
    const all = await this.readAll();
    const idx = all.findIndex((e) => e.id === afterEventId);
    if (idx === -1) return all;
    return all.slice(idx + 1);
  }
}
```

- [ ] **Step 9: Create events/index.ts**

```ts
// packages/core/src/events/index.ts
export { createAppEvent } from "./app-event.js";
export { EventWriter } from "./event-writer.js";
export { EventReader } from "./event-reader.js";
```

- [ ] **Step 10: Update core index.ts**

Add:

```ts
export { createAppEvent, EventWriter, EventReader } from "./events/index.js";
```

- [ ] **Step 11: Run all event tests**

Run: `pnpm --filter @reporead/core test -- src/events`
Expected: PASS.

- [ ] **Step 12: Commit**

```bash
git add packages/core/src/events/ packages/core/src/index.ts
git commit -m "feat(B022): unified event system with ndjson persistence

AppEvent factory, EventWriter for append-only ndjson,
EventReader with readAll and readSince for SSE replay."
```

---

## Task 13: Job State Machine (B024)

**Files:**
- Create: `packages/core/src/generation/job-state.ts`
- Create: `packages/core/src/generation/index.ts`
- Test: `packages/core/src/generation/__tests__/job-state.test.ts`

- [ ] **Step 1: Write failing test**

```ts
// packages/core/src/generation/__tests__/job-state.test.ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";
import { JobStateManager } from "../job-state.js";
import { StorageAdapter } from "../../storage/storage-adapter.js";
import type { GenerationJob, JobStatus } from "../../types/generation.js";
import type { ResolvedConfig } from "../../types/config.js";

describe("JobStateManager", () => {
  let tmpDir: string;
  let storage: StorageAdapter;
  let manager: JobStateManager;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "reporead-job-"));
    storage = new StorageAdapter(tmpDir);
    await storage.initialize();
    manager = new JobStateManager(storage);
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it("creates a new job in queued state", async () => {
    const job = await manager.create("test-proj", tmpDir, {} as ResolvedConfig);
    expect(job.status).toBe("queued");
    expect(job.projectSlug).toBe("test-proj");
    expect(job.id).toBeDefined();
    expect(job.versionId).toBeDefined();
  });

  it("transitions to cataloging", async () => {
    const job = await manager.create("proj", tmpDir, {} as ResolvedConfig);
    const updated = await manager.transition(job.projectSlug, job.id, "cataloging");
    expect(updated.status).toBe("cataloging");
    expect(updated.startedAt).toBeDefined();
  });

  it("rejects invalid transition", async () => {
    const job = await manager.create("proj", tmpDir, {} as ResolvedConfig);
    await expect(
      manager.transition(job.projectSlug, job.id, "publishing"),
    ).rejects.toThrow("JOB_INVALID_STATE");
  });

  it("reads job from disk", async () => {
    const job = await manager.create("proj", tmpDir, {} as ResolvedConfig);
    const loaded = await manager.get("proj", job.id);
    expect(loaded).not.toBeNull();
    expect(loaded!.id).toBe(job.id);
  });

  it("records failure with error message", async () => {
    const job = await manager.create("proj", tmpDir, {} as ResolvedConfig);
    await manager.transition(job.projectSlug, job.id, "cataloging");
    const failed = await manager.fail(job.projectSlug, job.id, "LLM timeout");
    expect(failed.status).toBe("failed");
    expect(failed.lastError).toBe("LLM timeout");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @reporead/core test -- src/generation`
Expected: FAIL.

- [ ] **Step 3: Implement JobStateManager**

```ts
// packages/core/src/generation/job-state.ts
import { randomUUID } from "node:crypto";
import { AppError } from "../errors.js";
import type { StorageAdapter } from "../storage/storage-adapter.js";
import type { GenerationJob, JobStatus } from "../types/generation.js";
import type { ResolvedConfig } from "../types/config.js";

const VALID_TRANSITIONS: Record<JobStatus, JobStatus[]> = {
  queued: ["cataloging", "failed"],
  cataloging: ["page_drafting", "failed", "interrupted"],
  page_drafting: ["reviewing", "failed", "interrupted"],
  reviewing: ["validating", "failed", "interrupted"],
  validating: ["page_drafting", "publishing", "failed", "interrupted"],
  publishing: ["completed", "failed"],
  completed: [],
  interrupted: ["cataloging", "page_drafting", "reviewing", "validating"],
  failed: ["cataloging", "page_drafting", "reviewing", "validating"],
};

function generateVersionId(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  const h = String(now.getHours()).padStart(2, "0");
  const min = String(now.getMinutes()).padStart(2, "0");
  const s = String(now.getSeconds()).padStart(2, "0");
  return `${y}-${m}-${d}-${h}${min}${s}`;
}

export class JobStateManager {
  constructor(private readonly storage: StorageAdapter) {}

  async create(
    projectSlug: string,
    repoRoot: string,
    config: ResolvedConfig,
  ): Promise<GenerationJob> {
    const job: GenerationJob = {
      id: randomUUID(),
      projectSlug,
      repoRoot,
      versionId: generateVersionId(),
      status: "queued",
      createdAt: new Date().toISOString(),
      configSnapshot: config,
      summary: {},
    };

    await this.persist(projectSlug, job);
    return job;
  }

  async get(projectSlug: string, jobId: string): Promise<GenerationJob | null> {
    return this.storage.readJson<GenerationJob>(
      this.storage.paths.jobStateJson(projectSlug, jobId),
    );
  }

  async transition(
    projectSlug: string,
    jobId: string,
    targetStatus: JobStatus,
  ): Promise<GenerationJob> {
    const job = await this.requireJob(projectSlug, jobId);
    const allowed = VALID_TRANSITIONS[job.status];

    if (!allowed.includes(targetStatus)) {
      throw new AppError(
        "JOB_INVALID_STATE",
        `Cannot transition from "${job.status}" to "${targetStatus}"`,
        { jobId, current: job.status, target: targetStatus },
      );
    }

    job.status = targetStatus;

    if (targetStatus === "cataloging" && !job.startedAt) {
      job.startedAt = new Date().toISOString();
    }
    if (targetStatus === "completed" || targetStatus === "failed") {
      job.finishedAt = new Date().toISOString();
    }

    await this.persist(projectSlug, job);
    return job;
  }

  async fail(
    projectSlug: string,
    jobId: string,
    error: string,
  ): Promise<GenerationJob> {
    const job = await this.requireJob(projectSlug, jobId);
    job.status = "failed";
    job.lastError = error;
    job.finishedAt = new Date().toISOString();
    await this.persist(projectSlug, job);
    return job;
  }

  async updatePage(
    projectSlug: string,
    jobId: string,
    pageSlug: string,
    nextOrder?: number,
  ): Promise<GenerationJob> {
    const job = await this.requireJob(projectSlug, jobId);
    job.currentPageSlug = pageSlug;
    if (nextOrder !== undefined) job.nextPageOrder = nextOrder;
    await this.persist(projectSlug, job);
    return job;
  }

  private async requireJob(projectSlug: string, jobId: string): Promise<GenerationJob> {
    const job = await this.get(projectSlug, jobId);
    if (!job) {
      throw new AppError("JOB_NOT_FOUND", `Job "${jobId}" not found in project "${projectSlug}"`);
    }
    return job;
  }

  private async persist(projectSlug: string, job: GenerationJob): Promise<void> {
    await this.storage.writeJson(
      this.storage.paths.jobStateJson(projectSlug, job.id),
      job,
    );
  }
}
```

- [ ] **Step 4: Create generation/index.ts**

```ts
// packages/core/src/generation/index.ts
export { JobStateManager } from "./job-state.js";
```

- [ ] **Step 5: Update core index.ts**

Add:

```ts
export { JobStateManager } from "./generation/index.js";
```

- [ ] **Step 6: Run tests**

Run: `pnpm --filter @reporead/core test -- src/generation`
Expected: PASS — all 5 job state tests pass.

- [ ] **Step 7: Commit**

```bash
git add packages/core/src/generation/ packages/core/src/index.ts
git commit -m "feat(B024): job state machine with valid transitions

State machine enforces: queued -> cataloging -> page_drafting ->
reviewing -> validating -> publishing -> completed. Supports
interrupt, fail, resume transitions. Persists to job-state.json."
```

---

## Task 14: CLI init Command (B015)

**Files:**
- Modify: `packages/cli/src/cli.tsx`
- Create: `packages/cli/src/commands/init.tsx`
- Create: `packages/cli/src/commands/providers.tsx`
- Test: `packages/cli/src/__tests__/commands/init.test.ts`

- [ ] **Step 1: Write failing test for init command**

```ts
// packages/cli/src/__tests__/commands/init.test.ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";
import { runInit } from "../commands/init.js";

describe("runInit", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "reporead-init-"));
    // Create a fake git repo
    await fs.mkdir(path.join(tmpDir, ".git"), { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it("creates .reporead directory and project.json", async () => {
    await runInit({ repoRoot: tmpDir, projectSlug: "test-init" });
    const projectJson = path.join(tmpDir, ".reporead", "projects", "test-init", "project.json");
    const exists = await fs.stat(projectJson).then(() => true).catch(() => false);
    expect(exists).toBe(true);
  });

  it("creates current.json pointing to new project", async () => {
    await runInit({ repoRoot: tmpDir, projectSlug: "test-init" });
    const currentJson = path.join(tmpDir, ".reporead", "current.json");
    const content = JSON.parse(await fs.readFile(currentJson, "utf-8"));
    expect(content.projectSlug).toBe("test-init");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @reporead/cli test`
Expected: FAIL.

- [ ] **Step 3: Implement runInit**

```ts
// packages/cli/src/commands/init.tsx
import * as path from "node:path";
import { StorageAdapter, ProjectModel } from "@reporead/core";

export interface InitOptions {
  repoRoot: string;
  projectSlug?: string;
}

export async function runInit(options: InitOptions): Promise<void> {
  const repoRoot = path.resolve(options.repoRoot);
  const slug = options.projectSlug ?? path.basename(repoRoot);

  const storage = new StorageAdapter(repoRoot);
  await storage.initialize();

  const projectModel = new ProjectModel(storage);
  const project = await projectModel.create({
    projectSlug: slug,
    repoRoot,
    branch: "main",
  });

  // Write current.json
  await storage.writeJson(storage.paths.currentJson, {
    projectSlug: project.projectSlug,
    repoRoot: project.repoRoot,
  });

  console.log(`Initialized RepoRead project "${slug}" at ${repoRoot}`);
}
```

- [ ] **Step 4: Update cli.tsx to wire init**

```tsx
// packages/cli/src/cli.tsx
import { Command } from "commander";
import { runInit } from "./commands/init.js";

export function createProgram(): Command {
  const program = new Command();

  program
    .name("repo-read")
    .description("Local-first code reading & technical writing workbench")
    .version("0.1.0");

  program
    .command("init")
    .description("Initialize a new RepoRead project")
    .option("-d, --dir <path>", "Repository root directory", process.cwd())
    .option("-n, --name <slug>", "Project slug name")
    .action(async (opts) => {
      await runInit({ repoRoot: opts.dir, projectSlug: opts.name });
    });

  program
    .command("providers")
    .description("Manage LLM provider credentials and role model mappings")
    .action(() => {
      console.log("repo-read providers — not yet implemented");
    });

  return program;
}
```

- [ ] **Step 5: Run tests**

Run: `pnpm --filter @reporead/cli test`
Expected: PASS.

- [ ] **Step 6: Verify CLI init works end-to-end**

Run: `cd /tmp && mkdir test-repo && cd test-repo && git init && pnpm --filter @reporead/cli dev -- init -d .`
Expected: "Initialized RepoRead project..." message, `.reporead/` directory created.

- [ ] **Step 7: Commit**

```bash
git add packages/cli/src/
git commit -m "feat(B015): CLI init command

Creates .reporead directory, project.json, and current.json.
Accepts --dir and --name options."
```

---

## Task 15: Full Test Suite Verification

**Files:** None (verification only)

- [ ] **Step 1: Run all tests across workspace**

Run: `pnpm test`
Expected: All tests pass across @reporead/core and @reporead/cli.

- [ ] **Step 2: Run type check**

Run: `pnpm typecheck`
Expected: No errors in any package.

- [ ] **Step 3: Verify web still builds**

Run: `pnpm --filter @reporead/web build`
Expected: Next.js build succeeds.

- [ ] **Step 4: Summary check**

Verify these modules are complete and exported from `@reporead/core`:
- `types/*` — All DTOs from design.md
- `config/` — Schema, loader, resolver
- `secrets/` — SecretStore with keychain + env
- `providers/` — ProviderInterface, capability table, model-route, ProviderCenter
- `storage/` — StoragePaths, StorageAdapter
- `project/` — ProjectModel CRUD
- `events/` — AppEvent factory, EventWriter, EventReader
- `generation/` — JobStateManager with state machine

---

## Dependency Graph

```
Task 1 (B001: Root scaffold)
  └─→ Task 2 (B002: TS/lint/test)
       └─→ Task 3 (B003: Core types)
       │    └─→ Task 5 (B010: Config schema)
       │         └─→ Task 6 (B010: Config loader/resolver)
       │              └─→ Task 7 (B011: Secrets)
       │                   └─→ Task 8 (B012: Provider capability)
       │                        └─→ Task 9 (B013+B014: Model route + ProviderCenter)
       │    └─→ Task 10 (B020: Storage)
       │         └─→ Task 11 (B021: Project model)
       │         └─→ Task 12 (B022: Events)
       │         └─→ Task 13 (B024: Job state)
       └─→ Task 4 (B004: CLI/Web shells)
            └─→ Task 14 (B015: CLI init)
```

Tasks 10-13 can be parallelized after Task 3 is complete.

---

## Notes for Implementer

1. **Zod v4 import**: Use `import { z } from "zod/v4"` (not `"zod"`). Zod v4 uses a separate entry point.
2. **ESM**: All files use ESM imports with `.js` extensions in import paths (TypeScript requires this for Node16 module resolution).
3. **keytar**: It's an optional dependency. If `import("keytar")` fails, SecretStore falls back to env vars. Don't add keytar to required dependencies — it will be installed by users who want keychain support.
4. **Tests use temp directories**: Every test that touches the filesystem creates a fresh temp dir and cleans it up. No test pollution.
5. **No Turborepo yet**: The plan uses plain `pnpm -r run` scripts. Turborepo can be added later if build times become a problem.
