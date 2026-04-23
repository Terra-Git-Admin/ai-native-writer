// One-shot rollout of healFixedTabs across every document in the DB.
//
// The regular GET /api/documents/[id]/tabs path already heals lazily on
// first fetch, but in-flight deploys leave docs un-healed until a writer
// opens them. This script forces the pass everywhere so prompts, badges,
// and the context engine see consistent canonical tabs immediately.
//
//   DATABASE_PATH=./data/writer.db npx tsx scripts/heal-all-docs.ts
//
// Run on staging first, compare with `audit-tabs.ts` output, then repeat on
// prod. Idempotent — running twice is fine.

import { db } from "../src/lib/db";
import { documents } from "../src/lib/db/schema";
import { healFixedTabs } from "../src/lib/tab-heal";

async function main() {
  const docs = await db.select({ id: documents.id, title: documents.title }).from(documents);
  let healed = 0;
  let skipped = 0;
  const failures: { docId: string; error: string }[] = [];

  for (const d of docs) {
    try {
      const ran = await healFixedTabs(d.id);
      if (ran) {
        healed += 1;
        console.log(`healed ${d.id} — ${d.title}`);
      } else {
        skipped += 1;
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      failures.push({ docId: d.id, error: message });
      console.error(`FAILED ${d.id} — ${d.title}: ${message}`);
    }
  }

  console.log(
    `\ndone. total=${docs.length} healed=${healed} skipped=${skipped} failed=${failures.length}`
  );
  if (failures.length > 0) {
    console.error(JSON.stringify(failures, null, 2));
    process.exit(1);
  }
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
