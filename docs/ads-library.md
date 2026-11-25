# Admin Ads Library

The Ads Library is an admin-only cross-Series catalog. Writers keep the existing Series-first Ad Lab and protected Ads tab. The catalog reads saved Ads-tab content and stores only the admin-owned Creative Family → Subtype classification.

## Data contract

- Every cataloged ad starts at an H3 heading named `Ad: <title>`.
- `anwSectionUid` on that heading is its stable identity inside the Series.
- A classification is either a complete Family/Subtype pair or absent (Unclassified).
- Ad content remains in `tabs.content`; the taxonomy tables never duplicate it.

## Local verification

```powershell
npm run test:ads-library
npm run test:ad-lab
npm run test:document-organization
npm run lint
npm run build
```

## Controlled rollout

Production stays hidden unless both flags are enabled:

```text
ADS_LIBRARY_ENABLED=true
NEXT_PUBLIC_ADS_LIBRARY_ENABLED=true
```

After explicit migration approval, apply migration `0017_admin_ads_library`. Before enabling the flags, run the UID backfill in dry-run mode against the intended database and review its counts:

```powershell
npm run backfill:ads-library -- --db=<absolute-database-path>
```

Only after separate approval for the data write, re-run with `--apply`. The backfill is idempotent and changes only hidden H3 UID attributes.
