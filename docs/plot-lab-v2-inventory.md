# Plot Lab V2 implementation inventory

Date: 2026-11-20
Branch: `feat/plot-lab-levi-v2`
Base: `origin/main` at `13a372b`

This is the Phase 0 cleanup and reuse matrix for the durable Levi rebuild. Nothing in this inventory is approved for deletion. The old Stage 1 implementation remains the rollback path until the V2 admin pilot passes and cleanup is separately approved.

## Current ownership boundary

The current `PlotLabWorkspace` owns the conversation, controller state, feedback, capture mode, streaming state, and decision-save behavior in React state. Only pane width persists in `localStorage`. A reload therefore cannot restore a canonical Plot Lab conversation or workflow checkpoint.

The V2 boundary will keep pane width, scroll, modal state, and the unsent draft in the browser. Sessions, messages, actions, proposals, snapshots, jobs, outputs, and feedback move behind the dedicated server workflow API.

## Reuse and cleanup matrix

| Existing item | Current role | V2 disposition | Notes |
|---|---|---|---|
| `src/components/labs/PlotLabWorkspace.tsx` | Resizable pane plus browser-owned Stage 1 workflow | Adapt shell; replace workflow internals | Preserve right-side placement, resize behavior, document-tab compatibility, and close behavior. Keep old component reachable through the rollback flag during pilot. |
| `src/app/doc/[id]/page.tsx` Plot Lab mounting | Opens Plot Lab beside the editor | Adapt minimally | V2 selection must be server-flagged. Existing normal document tab navigation remains authoritative. |
| `src/lib/plot-lab/access.ts` | Private-release and document access gate | Reuse and extend | Add a server-authoritative V2 flag; keep admin/user/document authorization. |
| `src/app/api/plot-lab/access/route.ts` | Returns Plot Lab access | Reuse or fold into session bootstrap | Any V2 response must still authorize through the document. |
| `src/lib/plot-lab/controller.ts` | Browser-side Stage 1 controller | Supersede but retain during pilot | Do not evolve it into the durable V2 state machine. |
| `src/lib/plot-lab/orchestration.ts` | Stage 1 specialist routing and parsing | Supersede but retain during pilot | V2 uses Interviewer, format-specific Creative, and Connector roles. |
| `src/lib/plot-lab/workflow.ts` | Infers workflow from tagged decision content | Keep for Stage 1 compatibility | V2 workflow state comes from the server session, not document text inference. |
| Plot Lab prompt constants and registry entries | Stage 1 specialist prompts | Keep for rollback; add separate V2 IDs | V2 prompt edits require version title and dated changelog updates. |
| `plot_lab_decisions` canonical tab | Stores explicit Stage 1 locks | Keep unchanged initially | V2 does not silently write generated output to document tabs. |
| `src/lib/ai/jobs.ts` | One-shot durable job row with in-memory stream runner | Refactor transport and persistence contracts | Reuse SSE/cancel concepts and provider runner; add persisted stages, checkpoints, CAS commits, scoped concurrency, and recoverable interruption. |
| `src/app/api/ai/jobs/**` | Generic job create/read/SSE/cancel | Keep for existing Writer jobs | V2 gets dedicated workflow/job routes while sharing low-level execution and transport utilities. |
| `ai_jobs` table | Generic one-shot job state | Add nullable V2 durability fields later | Schema design is in scope; creating/applying a migration remains approval-gated. |
| `ai_chat_history` | Generic assistant history | Keep unchanged | Never use it as Plot Lab workflow persistence. |
| Prompt DB and code fallbacks | Runtime prompt registry | Reuse | Add the five V2 prompt IDs without changing current prompt IDs. |
| Pitch Lab safe URL loader | Safe external reference capture | Extract/reuse | Preserve DNS/IP checks, redirect validation, timeout, byte cap, and extraction bounds. |
| `scripts/plot-lab-regression.test.mjs` | Stage 1 regression guard | Keep | Add separate V2 domain, repository, route, and browser tests. |
| Existing local Plot Lab branches/worktrees | Experiments and prior feature lines | Retain as history | No branch or worktree cleanup without explicit approval. |

## Shared hotspots

- `src/lib/db/schema.ts` and future migration files
- `src/lib/ai/jobs.ts` and the provider/model execution boundary
- `src/lib/ai/prompts.ts` plus prompt defaults
- `src/app/doc/[id]/page.tsx`
- `src/components/labs/PlotLabWorkspace.tsx`

These files should be edited sequentially, not by parallel implementation lanes.

## Confirmed implementation order

1. Domain contracts and pure state transitions.
2. Schema design and repository interfaces, stopping before migration creation/application.
3. Training schema and V2 role contracts.
4. Workflow API with mocked role execution.
5. Durable staged job refactor.
6. Chat UI integration behind the V2 flag.
7. Local verification, then separately approved migration/real-AI/release gates.
