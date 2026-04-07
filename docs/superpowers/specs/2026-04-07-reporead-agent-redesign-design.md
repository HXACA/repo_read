# RepoRead Agent Redesign Spec

> Date: 2026-04-07
> Status: Draft approved in chat, written for review
> Scope: Redesign the current RepoRead product/engineering/agent docs around a lighter, claude-code-like local reading agent architecture
> Target docs:
> - `docs/prd.md`
> - `docs/design.md`
> - `docs/agent-architecture.md`

---

## 1. Goal

RepoRead should stop drifting toward a heavy multi-agent, RAG-centric research system and instead become a high-quality local code reading and technical book generation tool.

The new direction is:

- local-first
- quality-first
- single main control loop
- lightweight file-based storage
- real-time local retrieval
- isolated independent review
- minimal user-facing configurability

This spec is the design source of truth for the next doc rewrite.

---

## 2. Core Product Thesis

RepoRead is not "an AI wiki generator with lots of agents".

RepoRead is:

- a local repository reading workbench
- a system that writes a technical book-like wiki in strict reading order
- a system that answers follow-up code questions using human-like local retrieval
- a system that treats review as an independent second opinion, not as self-polishing

The experience target is closer to `claude-code` doing deep local code reading than to a classic RAG app.

---

## 3. Primary Architecture

### 3.1 Main Structure

RepoRead should adopt:

`single main loop + two delegation primitives + deterministic validators`

There should not be many peer top-level agents like `CatalogAgent`, `PageWriterAgent`, `ChatAgent`, `ResearchSynthesizerAgent`, and so on.

Instead:

- one main control agent implementation drives the whole system
- that main agent runs in different modes:
  - `catalog`
  - `page`
  - `ask`
  - `research`
- delegation is narrow and explicit
- deterministic validators remain separate from the agent

### 3.2 Why

This keeps:

- continuity across chapters
- a strong "author writing a book" mental model
- a simpler runtime
- less context fragmentation
- less architectural bloat

It also better matches how strong coding agents actually feel in use: one main thread of reasoning, with targeted delegation only when needed.

---

## 4. Delegation Semantics

RepoRead should support exactly two delegation semantics.

### 4.1 `fork worker`

Purpose:

- page-internal parallel retrieval
- section-level evidence gathering
- local sub-summary generation
- narrow, non-overlapping inspection tasks

Properties:

- inherits parent context
- inherits parent system framing
- receives a short directive, not a full briefing
- does not own final judgment
- does not write final page output
- does not recursively delegate
- returns a compact structured report

Use cases:

- inspect 3 candidate files in parallel
- summarize 3 subsections independently
- compare 2 implementation branches inside one page
- gather evidence for several claims before drafting

### 4.2 `fresh reviewer`

Purpose:

- independent technical review
- isolated second opinion
- factual challenge to the main agent draft
- occasional independent verification beyond the provided evidence pack

Properties:

- new session
- no inherited chain-of-thought or running context
- receives a complete briefing
- allowed to re-run local retrieval
- outputs only review results, not replacement authorship

Use cases:

- review a completed page draft
- challenge unsupported conclusions
- detect omissions, contradictions, or weak evidence
- validate whether a page matches chapter scope

### 4.3 Explicit Non-Goal

RepoRead should not become a general "agent swarm" product.

There is no need to expose a large team of productized named agents. The runtime should stay centered on:

- `main.author`
- `fork.worker`
- `fresh.reviewer`

Optionally later:

- `fresh.researcher`

But that is a later extension, not a core V1 requirement.

---

## 5. Page Generation Model

### 5.1 Global Order

Page generation must be strictly serial.

After catalog creation:

`Page 1 -> review -> validate -> Page 2 -> review -> validate -> ...`

There should be no cross-page parallel generation.

### 5.2 Reason

The wiki should behave like a book manuscript:

- earlier chapters establish shared concepts
- later chapters can reference earlier chapters
- recommendations and cross-links should grow from already-written material
- structure should improve as the book progresses

### 5.3 Allowed Parallelism

Parallelism is only allowed inside a single page.

Examples:

- multiple evidence searches
- multiple file inspections
- multiple subsection evidence digests
- multiple narrow comparison tasks

The main agent remains the only writer and integrator for the page.

---

## 6. Retrieval Philosophy

### 6.1 Hard Decision

RepoRead should not use:

- RAG
- embeddings
- vector retrieval
- SQLite
- heavy prebuilt code indexes

### 6.2 Retrieval Model

RepoRead should use:

`lightweight manifests + real-time local retrieval`

The manifests act like a library card catalog. They help navigation and orientation, but they do not replace direct reading of source material.

### 6.3 Real-Time Retrieval Sources

Primary retrieval should come from local tools such as:

- `rg`
- `find`
- `git`
- file window reads
- already-generated page markdown

The system should feel like a careful engineer reading a local codebase, not like a semantic retrieval product.

---

## 7. Lightweight Manifest Policy

Only minimal file-based manifests should be stored.

### 7.1 Allowed Persistent Artifacts

- `wiki.json`
- `pages/<slug>.md`
- `pages/<slug>.meta.json`
- page or version citation manifest
- `version.json`
- `current.json`
- `job-state.json`
- review summaries
- ndjson logs

### 7.2 Manifest Responsibilities

These manifests are allowed to support:

- navigation
- reading order
- page metadata
- chapter relationships
- citation mapping
- recovery and resume
- version browsing

They should not become hidden code indexes.

### 7.3 Explicit Limits

Do not add:

- symbol databases
- code chunk databases
- vector stores
- SQLite FTS search layers
- large generated code indexes

The system should trust model reasoning plus live local retrieval.

---

## 8. Tool System

### 8.1 Tool Philosophy

RepoRead should reuse proven coding-agent tool ideas and names as much as possible.

Do not invent a parallel vocabulary unless RepoRead has a domain-specific reason.

### 8.2 Preferred Core Tool Set

The baseline should be drawn from `claude-code`, `codex`, `opencode`, and `oh-my-openagent`, then trimmed for RepoRead's read-only scope.

Recommended high-frequency tools:

- `Read`
- `Grep`
- `Glob` or `Find`
- `Bash`
- `Git`
- `Agent`
- `Task`
- `SendMessage`

RepoRead-specific domain helpers may include:

- `PageRead`
- `CitationOpen`

### 8.3 Tool Priority

The normal retrieval path should be:

1. page manifests and current page context
2. `Grep`
3. `Find` / `Glob`
4. `Read`
5. `Git`
6. `Bash` as controlled fallback

`Bash` should not be the primary abstraction. It is a fallback shell around local read operations.

### 8.4 Tool Reuse Principle

If a mature implementation already exists in the reference repos and fits RepoRead's boundary, prefer copying or adapting it over redesigning from scratch.

RepoRead should optimize for leverage, not originality.

---

## 9. Parallelism Rules

### 9.1 Parallelism Principle

Parallelism exists to reduce local evidence collection latency inside one page, not to turn RepoRead into a distributed authoring swarm.

### 9.2 Allowed Parallelism

Allowed:

- multiple fork workers launched for non-overlapping page-local subtasks
- multiple read/search tool calls in one step when independent

Not allowed:

- two agents writing different pages at once
- two agents reviewing and authoring the same page simultaneously
- duplicated exploration by both main agent and a delegated worker

### 9.3 Anti-Duplication Rule

Once the main agent delegates a narrow search or inspection task, it should not redo the same search itself unless the first result failed or returned insufficient evidence.

This rule should be written into the agent behavior docs explicitly.

---

## 10. Review Model

### 10.1 Human Team Analogy

RepoRead should model page production more like a technical book team:

- `Author`: main agent
- `Technical Reviewer`: fresh reviewer
- `Copy/Structure Checker`: deterministic validators
- `Editor/Publisher`: final packager

### 10.2 Reviewer Inputs

The fresh reviewer should receive:

- page title
- chapter position
- global book summary
- current page draft
- current page citations
- covered files
- explicit review questions

### 10.3 Reviewer Output Contract

The reviewer should return a compact structured result, for example:

- `verdict`
- `blockers`
- `factual_risks`
- `missing_evidence`
- `scope_violations`
- `suggested_revisions`

The reviewer is not the replacement author. The main agent owns revision.

### 10.4 Reviewer Permissions

The reviewer must be allowed to independently re-check local evidence with the same read-only retrieval tools.

This is important to avoid:

- context contamination
- author overconfidence
- rubber-stamp review

---

## 11. Model Configuration

### 11.1 User-Facing Configuration Must Stay Minimal

Users should not be given a large configuration surface.

Expose only role-level model configuration for:

- `main.author`
- `fork.worker`
- `fresh.reviewer`

Each role may define:

- `model`
- `fallback_models`

Nothing more should be required for ordinary users.

### 11.2 Internal System-Owned Prompt Tuning

The system should maintain internal model-family prompt tuning profiles.

These profiles are not user-configurable.

They may adjust:

- prompt append blocks
- output framing
- review strictness wording
- tool-use reminders
- verbosity constraints
- formatting stabilization

This keeps the system adaptive to model differences without becoming a user-facing tuning platform.

### 11.3 Role-Specific Fallbacks

Fallback chains must be role-local.

If `fresh.reviewer` fails, it should use the reviewer fallback chain, not silently inherit the author chain.

Likewise, `fork.worker` can have a cheaper or faster fallback path without changing the author behavior.

---

## 12. CLI and Web Experience

### 12.1 CLI Role

CLI is the entry and process surface:

- init/config/providers
- generate/jobs
- ask
- browse
- doctor
- versions

CLI output should reflect a book-writing workflow:

- writing current page
- gathering evidence
- reviewing page
- revising draft
- validating page

Not raw agent internals.

### 12.2 Web Role

Web is the long-form reading and follow-up interface:

- library/project shelf
- version browsing
- left sidebar book structure
- main content reader
- citations and source drawer
- page-aware chat dock

Search should first use manifests for quick structural hits, then fall through to live local search.

### 12.3 User Mental Model

Users should experience RepoRead as:

- reading a technical book
- opening source citations when needed
- asking follow-up questions in place
- seeing when a page is under review or revised

Users should not need to understand `fork worker` or `fresh reviewer` vocabulary.

---

## 13. Quality Policy

### 13.1 No Hard Time Targets

RepoRead should not commit to aggressive wall-clock generation targets.

The docs should remove minute-based performance promises and replace them with:

- quality-first language
- resumable workflow guarantees
- recoverable generation stages

### 13.2 Publish Gates

A page cannot be treated as publishable unless:

- review passes or revisions are accepted
- structure validation passes
- citation validation passes
- link validation passes

### 13.3 Resume and Recovery

Generation may take longer. That is acceptable.

The system must therefore prioritize:

- resumability
- partial recovery
- page-by-page progress persistence
- clear restart points

---

## 14. Testing Strategy

### 14.1 Core Test Focus

Testing should emphasize:

- serial page authoring behavior
- page-internal fork retrieval integration
- fresh reviewer isolation
- deterministic validation gates
- recovery after interruption

### 14.2 Required Test Layers

- unit tests for tool wrappers, path guards, manifest persistence, and status recovery
- integration tests for one-page generation, fork worker fan-out/fan-in, and reviewer loops
- golden tests for catalog output, page output, reviewer output, and CLI ask formatting
- end-to-end tests for `init -> generate -> interrupt -> resume -> browse -> ask`

### 14.3 Human Review Criteria

Human evaluation should focus on:

- whether chapter order reads naturally
- whether later chapters genuinely build on earlier chapters
- whether review catches real issues
- whether retrieval feels local and grounded
- whether Web/CLI feel like a technical book workflow rather than a generic agent dashboard

---

## 15. Required Changes To Existing Docs

### 15.1 `docs/prd.md`

Rewrite to:

- remove hard time targets
- remove RAG framing
- reframe the product as a local reading/writing system with independent review
- state that generation is serial by page
- state that quality and recoverability dominate speed

### 15.2 `docs/design.md`

Rewrite to:

- remove SQLite and heavy index assumptions
- remove vector/semantic retrieval language
- replace with lightweight manifests plus live local retrieval
- define serial page pipeline and page-internal fork parallelism
- define lightweight file storage as the primary persistence model

### 15.3 `docs/agent-architecture.md`

Rewrite to:

- collapse many named agents into one main control loop
- define only two delegation primitives: `fork worker` and `fresh reviewer`
- define review as isolated, fresh-session technical review
- define role-level model config with internal system-owned prompt tuning
- define anti-duplication and delegation rules

---

## 16. Non-Goals

This redesign does not aim to:

- maximize throughput
- become a generalized multi-agent orchestration platform
- expose advanced prompt tuning to users
- rely on heavy retrieval infrastructure
- optimize for novelty over reuse

---

## 17. Acceptance

This redesign should be considered correctly implemented in the docs when:

1. the three core docs consistently describe one main control loop rather than many peer agents
2. all SQLite/RAG/vector retrieval assumptions are removed
3. strict serial page generation is explicit
4. `fork worker` and `fresh reviewer` semantics are explicit
5. role-level model/fallback config is explicit
6. internal model-family prompt tuning exists in the design but is not user-facing
7. tools are presented in reused coding-agent terminology
8. hard time targets are replaced by quality-first wording
