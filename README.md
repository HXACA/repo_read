# RepoRead

Local-first code reading and technical writing workbench. Generate rich wiki
documentation from any repository, read it with a custom-designed typography
stack, and ask questions against the code without ever leaving your machine.

See the [product requirements](docs/prd.md), the
[engineering design](docs/design.md) and the
[core agent architecture](docs/agent-architecture.md) for the full picture.

## Quick start

```bash
# 1. Build all packages
pnpm install
pnpm --filter @reporead/core run build
pnpm --filter @reporead/cli  run build
pnpm --filter @reporead/web  run build

# 2. Create the global config (API key, default provider, default language)
mkdir -p ~/.reporead
cat > ~/.reporead/config.json << 'EOF'
{
  "language": "zh",
  "providers": [
    {
      "provider": "anthropic",
      "secretRef": "ANTHROPIC_API_KEY",
      "apiKey": "sk-ant-...",
      "enabled": true
    }
  ],
  "roles": {
    "main.author":    { "model": "claude-sonnet-4-6",        "fallback_models": [] },
    "fork.worker":    { "model": "claude-haiku-4-5-20251001","fallback_models": [] },
    "fresh.reviewer": { "model": "claude-sonnet-4-6",        "fallback_models": [] }
  }
}
EOF

# 3. Initialize a project and generate a wiki for it
cd /path/to/your/repo
repo-read init
repo-read generate -d .

# 4. Browse the result in your browser
repo-read browse -d .
```

Project-level config files live at
`<repo>/.reporead/projects/<slug>/config.json`. They merge under the global
config, so you only need to write project-specific overrides (e.g. `preset`
or a different model for one project).

## Quality presets

Every project picks a `preset` that drives the runtime agent strategy. The
preset maps to a `QualityProfile` (see
`packages/core/src/config/quality-profile.ts`):

| Field                         | `quality` | `balanced` | `budget` | `local-only` |
| ----------------------------- | --------- | ---------- | -------- | ------------ |
| `forkWorkers`                 | 3         | 2          | 1        | 1            |
| `forkWorkerConcurrency`       | 3         | 2          | 1        | 1            |
| `maxRevisionAttempts`         | 3         | 2          | 1        | 1            |
| `drafterMaxSteps`             | 30        | 20         | 12       | 12           |
| `reviewerMaxSteps`            | 15        | 10         | 6        | 6            |
| `reviewerVerifyMinCitations`  | 3         | 2          | 0        | 0            |
| `reviewerStrictness`          | strict    | normal     | lenient  | normal       |

What these levers actually do:

- **forkWorkers / concurrency** — number of parallel `fork.worker` evidence
  collectors the `EvidenceCoordinator` runs per page. Higher = more evidence,
  more tokens. `1` short-circuits the planner LLM call entirely.
- **maxRevisionAttempts** — how many times the page may be re-drafted after
  the reviewer returns `verdict: revise` with at least one blocker.
- **drafterMaxSteps / reviewerMaxSteps** — `stepCountIs(N)` budget for each
  agent's tool-call loop.
- **reviewerVerifyMinCitations** — number of citations the reviewer MUST
  verify via the `read` tool. `0` disables the verification requirement.
  Any non-`match` verification is auto-promoted to a blocker.
- **reviewerStrictness** — tone setting surfaced in the reviewer system
  prompt (currently advisory).

Pick `quality` when fidelity matters (publishing a wiki), `balanced` for
most day-to-day work, `budget` when you're iterating fast or testing
prompts, `local-only` for Ollama-style local-model setups.

## Architecture at a glance

```
Main Control Loop
  main.author (single LLM orchestrator, 4 modes: catalog | page | ask | research)
    │
    ├── fork.worker   (delegate for parallel in-page evidence collection)
    ├── fresh.reviewer (delegate for independent page review with tool verification)
    │
    Deterministic runtime
    ├── Repo Snapshot / Retrieval tools
    ├── EvidenceCoordinator (plans + runs parallel fork.workers)
    ├── validator (structure / citations / links)
    └── Publisher (atomic version promotion)
```

See [`docs/agent-architecture.md`](docs/agent-architecture.md) §4 for how
`EvidenceCoordinator` implements the `fork.worker` primitive and §11 for the
reviewer's verification protocol.
