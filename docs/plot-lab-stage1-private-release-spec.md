# Plot Lab Stage 1 Private Release Spec

Date: 2026-10-08
Status: Implementation spec
Owner: Plot Lab / Levi

## Context

ANW has no staging environment for this workflow. The feedback build will therefore ship to the live ANW deployment, but access must be restricted to one teammate and gated to Plot Lab Stage 1 only.

This is not a broad Plot Lab launch. It is a controlled feedback release so Vikas and one non-technical teammate can test the same Stage 1 flow and compare feedback.

## Current State

Verified in `D:/codex-global/anw-plot-lab-v1` on 2026-10-08:

| Area | Current behavior | Gap |
|---|---|---|
| Auth | `src/lib/auth.ts` supports Google OAuth, `ALLOWED_DOMAIN`, DB user `active`, and admin roles. | No Plot Lab-specific allowlist exists. |
| Plot Lab entry | `src/app/doc/[id]/page.tsx` exposes Plot Lab from the document page and passes `isAdmin` into `PlotLabWorkspace`. | Access is not scoped to one tester. |
| Stage gate | `src/lib/plot-lab/controller.ts` has `stage_1_complete` and already instructs Levi to stop before beats/runway/Episode 2. | Needs release-grade enforcement and tests that Stage 2 remains unreachable. |
| Debug/reset | `src/components/labs/PlotLabWorkspace.tsx` has admin-only State panel, debug export, and `Clear decisions`. | Non-technical tester needs a safe, simple reset/export path without full admin power. |
| Data reset | `Clear decisions` resets only the active document's `Plot Lab Decisions` tab. | Tester also needs clear labeling and a clean-start path for chat/state, not only the tab. |

## Proposed Change

Ship a production-restricted Plot Lab Stage 1 pilot using an environment-controlled allowlist.

There are two separate concepts:

1. **Access allowlist**: decides who can see/use Plot Lab on live ANW.
2. **Tester tools**: lets the allowlisted non-technical teammate export debug data and reset their test doc without becoming a global admin.

## Product Contract

### Allowed Users

The private release must allow:

- Vikas / admin users.
- Exactly the configured teammate email(s) in `PLOT_LAB_ALLOWED_EMAILS`.

Everyone else:

- Can keep using normal ANW.
- Must not see the Plot Lab entry point.
- Must not be able to call Plot Lab API flows by manually crafting requests.

### Stage 1 Only

The tester can use only:

1. Opening read / context correction
2. Protagonist pass
3. Primary counterpart pass
4. Operator / pressure pass
5. Relationship / universe pass
6. Monetization endpoint
7. Monetization delta / universe bridge
8. Stage 1 complete summary

Blocked:

- first plot beat
- Episode 2
- episode runway
- episode sketches
- Stage 2 beat-building
- final plot expansion

### Tester UX

The teammate is non-technical. They need visible controls:

- `Export feedback JSON`
- `Start over`
- `Clear decisions`

`Export feedback JSON` downloads the existing Plot Lab debug payload.

`Clear decisions` resets only the `Plot Lab Decisions` tab to the default heading.

`Start over` resets the local Plot Lab chat/controller state and clears `Plot Lab Decisions` for the active test document. It must show a plain confirmation because it deletes the current test-session work for that document.

Do not expose full admin panels, prompt editor, user admin, or unrelated debug surfaces to the teammate.

## Implementation Details

### 1. Add Plot Lab Access Helper

Create `src/lib/plot-lab/access.ts`.

Interface:

```ts
import type { Session } from "next-auth";

export interface PlotLabAccess {
  canUsePlotLab: boolean;
  canUsePlotLabTesterTools: boolean;
  reason: "admin" | "allowlist" | "disabled" | "unauthenticated";
}

export function getPlotLabAccess(session: Session | null | undefined): PlotLabAccess;
```

Rules:

- Admin role always has access.
- `PLOT_LAB_ALLOWED_EMAILS` is a comma-separated email allowlist.
- Email comparison is case-insensitive and trimmed.
- Empty allowlist means admin-only.
- Allowed teammate gets `canUsePlotLab=true` and `canUsePlotLabTesterTools=true`.
- Non-allowed user gets both false.

Do not create a DB migration for this. Use env vars for the pilot.

### 2. Gate Plot Lab Entry Point

Update `src/app/doc/[id]/page.tsx`.

Behavior:

- Compute Plot Lab access from session.
- Hide the Plot Lab button unless `canUsePlotLab`.
- Do not auto-open Plot Lab from any query param unless `canUsePlotLab`.
- Pass `canUsePlotLabTesterTools` into `PlotLabWorkspace`.
- If `plotLabActive` somehow becomes true without access, close it and show the normal AI sidebar instead.

### 3. Gate Plot Lab AI Calls Server-Side

Update `src/app/api/ai/edit/route.ts`.

Behavior:

- For all `plot_lab_*` modes, call `getPlotLabAccess(session)`.
- If not allowed, return `403`.
- Keep existing admin-only restrictions for non-Plot-Lab admin modes.
- Do not let client-side hiding be the only control.

Plot Lab modes include at minimum:

- `plot_lab_chat`
- `plot_lab_source_reader`
- `plot_lab_character_analyst`
- `plot_lab_paywall_architect`
- `plot_lab_universe_builder`
- `plot_lab_continuity_audit`

Use the repo's actual mode list from `src/lib/ai/prompts.ts` / `src/app/api/ai/edit/route.ts` during implementation.

### 4. Tester Tools In Plot Lab Workspace

Update `src/components/labs/PlotLabWorkspace.tsx`.

Props:

```ts
canUseTesterTools: boolean;
```

Behavior:

- Admin still sees the State panel.
- Allowed tester sees a compact `Testing` menu or small controls, not the full admin state panel.
- `Export feedback JSON` is available to admin and tester.
- `Clear decisions` is available to admin and tester.
- `Start over` is available to admin and tester.

`Start over` must:

- clear current Plot Lab messages
- reset controller to `createInitialPlotLabControllerState()`
- clear feedback events
- clear streaming/error state
- call the same tab reset used by `Clear decisions`
- leave all non-Plot-Lab tabs untouched

### 5. Stage 1 Release Gate

Keep Stage 2 blocked in `src/lib/plot-lab/controller.ts`.

Required behavior:

- Once `phase === "stage_1_complete"`, `waitingFor` is `idle`.
- `turnPlan.actions` is empty or only non-advancing tester/debug actions.
- No controller transition from `stage_1_complete` to `plot_thread`.
- `plotDetailAllowed` remains false unless Stage 2 is explicitly enabled in a future release.

Optional env flag for future work:

```txt
PLOT_LAB_STAGE2_ENABLED=false
```

For this release, do not expose or wire Stage 2. If the flag is added, default must be false.

### 6. Feedback Data

Debug export must include:

- document id
- exported timestamp
- user turns
- assistant messages
- feedback events
- controller snapshots
- turn plans
- current phase/focus
- question vectors
- selected action source
- specialist/audit metadata

Do not include secrets, env vars, provider keys, OAuth tokens, or unrelated user data.

### 7. Live Test Document

Create or identify a clean live test document for the teammate after deployment approval.

The live document must:

- be owned by or shared with the teammate through existing ANW document access rules
- contain the intended EP1 source
- contain a clean `Plot Lab Decisions` tab
- not share Vikas's localhost test data

No production DB mutation or live doc setup happens without current-message approval.

## Acceptance Criteria

1. With `PLOT_LAB_ALLOWED_EMAILS` empty, only admins can see or use Plot Lab.
2. With `PLOT_LAB_ALLOWED_EMAILS=<tester email>`, that tester can see Plot Lab on a permitted document.
3. A non-allowed authenticated user cannot see the Plot Lab entry point.
4. A non-allowed authenticated user receives `403` if they call a `plot_lab_*` AI mode directly.
5. The tester can export debug JSON without admin role.
6. The tester can clear `Plot Lab Decisions` for the active document without affecting other tabs.
7. The tester can use `Start over` to reset local Plot Lab chat/controller state and clear `Plot Lab Decisions`.
8. Stage 1 completion stops the flow and does not ask for beats, Episode 2, runway, or sketches.
9. Regression test proves the controller cannot advance from `stage_1_complete` into Stage 2.
10. `npm run test:plot-lab`, `npm run lint`, and `npm run build` pass before release readiness.

## Testing Plan

| Layer | What | Count |
|---|---|---|
| Unit | `getPlotLabAccess()` admin, allowed tester, disallowed user, empty allowlist, case-insensitive email | +5 |
| Unit | Plot Lab controller stays stopped at `stage_1_complete` | +1 |
| API | `plot_lab_*` mode returns `403` for non-allowed user | +1 minimum if route test harness exists; otherwise manual smoke |
| UI/static | Plot Lab entry button is conditional on access helper result | +1 static assertion or component-level test |
| Manual local | Admin sees State/debug; tester-equivalent access sees tester tools only | +1 |
| Manual live | After approved deploy, tester opens one live doc, starts over, runs Stage 1, exports debug JSON | +1 |

## Release Plan

1. Implement access helper, UI gate, API gate, tester tools, and Stage 1 tests locally.
2. Run local checks.
3. Run local smoke using admin/bypass config.
4. Prepare release-readiness summary.
5. Ask Vikas for current-message approval to push/deploy.
6. After approval, set production env:

```txt
PLOT_LAB_ALLOWED_EMAILS=<teammate-email>
PLOT_LAB_STAGE2_ENABLED=false
```

7. Deploy via the ANW live release path.
8. Smoke test live with Vikas/admin.
9. Have teammate test the live URL and export feedback JSON.

## Rollback Plan

Fast rollback:

- Remove teammate email from `PLOT_LAB_ALLOWED_EMAILS`.
- Restart/redeploy app if env changes require it.

Code rollback:

- Revert the PR that adds the Plot Lab private release gate.

Data rollback:

- No schema change.
- No migration.
- Tester reset only touches the active document's `Plot Lab Decisions` tab and local browser state.

## Out Of Scope

- Stage 2 beat-building.
- Episode sketches.
- Multi-user collaboration inside the same Plot Lab session.
- New document-sharing model.
- New staging environment.
- Prompt rewrites unrelated to private release gating.
- Full admin dashboard for tester.
- Production data cleanup beyond the explicitly approved test document.

## Files Reference

| File | Change |
|---|---|
| `src/lib/plot-lab/access.ts` | New env-based access helper. |
| `src/app/doc/[id]/page.tsx` | Hide/show Plot Lab entry and pass tester-tool permission. |
| `src/app/api/ai/edit/route.ts` | Server-side `plot_lab_*` access gate. |
| `src/components/labs/PlotLabWorkspace.tsx` | Add tester-safe export/reset/start-over controls. |
| `src/lib/plot-lab/controller.ts` | Ensure Stage 1 complete is terminal for this release. |
| `scripts/plot-lab-regression.test.mjs` | Add allowlist and Stage 1 gate regression tests. |
| `.env.example` if present | Document `PLOT_LAB_ALLOWED_EMAILS` and optional `PLOT_LAB_STAGE2_ENABLED=false`. |

## Implementation Order

1. Access helper and tests.
2. Server-side API gate.
3. Document-page entry gate.
4. Tester-safe reset/export UI.
5. Stage 1 terminal regression test.
6. Local build/lint/test.
7. Release readiness summary.
