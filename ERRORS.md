# ERRORS.md — AI Native Writer

Failed approaches and what worked instead. Check before trying similar approaches.

---

## 2026-09-25 - Pitch Lab page wrapper cleanup gotcha

- **What failed:** `apply_patch` failed twice when trying to delete `src/app/pitch-lab/page.tsx` outright during the AI Studio migration.
- **Root cause:** The safer fallback was to make `page.tsx` a wrapper and comment the old body, but the old code contained a regex with `\s*/`, which closed the block comment early and caused a parser error.
- **What worked:** Added the new implementation in `src/components/pitch-lab/PitchLabStudioPage.tsx`, delegated from `page.tsx`, neutralized the commented regex enough for lint/build to pass, and logged cleanup as a Monday follow-up.
- **Note for next time:** For large page replacements, prefer moving the old file aside with a proper file replacement patch or a minimal wrapper edit that removes the old body completely. Avoid block-commenting old TSX that may contain `*/` in regexes or comments.

## 2026-10-01 - GStack browse QA packaging blocker

- **What failed:** Browser-click QA for local Plot Lab failed twice through `C:\Users\vikas\.codex\skills\gstack\browse\dist\browse.exe goto http://localhost:3000/doc/RZzvEJGZ6uv5`.
- **Root cause:** The browse binary reported `Cannot find server.ts. Set BROWSE_SERVER_SCRIPT env or run from the browse source tree.`
- **What worked:** Stopped after repeated failure per tool-failure rule; relied on build, API smoke, and user visual inspection instead.
- **Note for next time:** Before depending on gstack browse in this worktree, either set `BROWSE_SERVER_SCRIPT` to the browse server source or use another verified browser control path. Do not keep retrying the same browse command.

## 2026-10-07 - Plot Lab choice/state dogfood regressions

- **What failed:** Dogfood export `D:/plotpix/Levi/plot-lab-debug-2026-10-07T13-00-10-211Z.json` showed reroll changing the question, repeated same-vector questions, missing lock/review controls while `waitingFor: approve_lock`, and a post-monetization rewind back to monetization discovery after the endpoint was already locked.
- **Root cause:** Story choices were rendered as buttons, but the product still lacked a durable choice-session model. Reroll was treated like a fresh chat turn, lock-review controls depended too much on model output, question planning did not track cognitive vector, and monetization lock was not enforced as a one-way gate.
- **What worked:** Reframed the fix as an interaction/state architecture issue instead of a local prompt patch. The next plan requires option-only reroll, app-owned `Type my own answer`, mandatory app-owned lock-review controls, question-vector planning, source-grounding audit, and a hard post-monetization one-way gate.
- **Note for next time:** Do not test another real run until these v4.1 controller/UI fixes are implemented and `Plot Lab Decisions` is cleared again.

