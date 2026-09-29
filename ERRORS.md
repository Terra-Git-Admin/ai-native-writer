# ERRORS.md — AI Native Writer

Failed approaches and what worked instead. Check before trying similar approaches.

---

## 2026-09-25 - Pitch Lab page wrapper cleanup gotcha

- **What failed:** `apply_patch` failed twice when trying to delete `src/app/pitch-lab/page.tsx` outright during the AI Studio migration.
- **Root cause:** The safer fallback was to make `page.tsx` a wrapper and comment the old body, but the old code contained a regex with `\s*/`, which closed the block comment early and caused a parser error.
- **What worked:** Added the new implementation in `src/components/pitch-lab/PitchLabStudioPage.tsx`, delegated from `page.tsx`, neutralized the commented regex enough for lint/build to pass, and logged cleanup as a Monday follow-up.
- **Note for next time:** For large page replacements, prefer moving the old file aside with a proper file replacement patch or a minimal wrapper edit that removes the old body completely. Avoid block-commenting old TSX that may contain `*/` in regexes or comments.

