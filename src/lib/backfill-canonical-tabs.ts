import { nanoid } from "nanoid";
import { eq } from "drizzle-orm";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { tabs } from "@/lib/db/schema";
import type * as schema from "@/lib/db/schema";
import { CANONICAL_TABS } from "@/lib/canonical-tabs";

type Tx = BetterSQLite3Database<typeof schema>;

// Legacy tab types and their canonical equivalents. A doc that has `episode_plot`
// already occupies the `microdrama_plots` slot — don't insert a duplicate.
const LEGACY_EQUIV: Record<string, string> = {
  episode_plot: "microdrama_plots",
  reference_episode: "predefined_episodes",
};

// SYNCHRONOUS — called only inside a better-sqlite3 write transaction.
// No `await` anywhere in this function. Insert-only: never reads, mutates,
// or deletes tab content.
export function insertMissingCanonicalTabs(
  tx: Tx,
  docId: string
): { inserted: string[]; repositioned: number } {
  const now = new Date();

  // Read existing tab rows inside the txn. This (not a pre-read) is what makes
  // concurrent opens of the same stale doc safe — a second open re-reads the
  // already-stamped state and skips.
  const existing = tx
    .select({ id: tabs.id, type: tabs.type, position: tabs.position })
    .from(tabs)
    .where(eq(tabs.documentId, docId))
    .orderBy(tabs.position)
    .all();

  // Build the set of canonical type slots already filled (including via legacy types).
  const presentCanonical = new Set<string>();
  for (const row of existing) {
    presentCanonical.add(row.type);
    const equiv = LEGACY_EQUIV[row.type];
    if (equiv) presentCanonical.add(equiv);
  }

  // Insert any canonical tab whose type is missing.
  const inserted: string[] = [];
  for (const spec of CANONICAL_TABS) {
    if (!presentCanonical.has(spec.type)) {
      const id = nanoid(12);
      tx.insert(tabs)
        .values({
          id,
          documentId: docId,
          title: spec.title,
          type: spec.type,
          sequenceNumber: null,
          content: spec.content,
          position: spec.position,
          isProtected: true,
          createdAt: now,
          updatedAt: now,
        })
        .run();
      inserted.push(spec.type);
    }
  }

  // Re-read all rows (existing + newly inserted) for position normalization.
  const allRows = tx
    .select({ id: tabs.id, type: tabs.type, position: tabs.position })
    .from(tabs)
    .where(eq(tabs.documentId, docId))
    .orderBy(tabs.position)
    .all();

  // Build target position map: canonical slots 0–10, legacy types mapped to their
  // canonical position, non-canonical types (custom, research, archive) trail at 11+.
  const canonicalPositionMap = new Map<string, number>(
    CANONICAL_TABS.map((s) => [s.type, s.position])
  );
  for (const [legacy, canonical] of Object.entries(LEGACY_EQUIV)) {
    const pos = canonicalPositionMap.get(canonical);
    if (pos !== undefined) canonicalPositionMap.set(legacy, pos);
  }

  let repositioned = 0;
  let trailingPos = 11;

  for (const row of allRows) {
    const targetPos = canonicalPositionMap.has(row.type)
      ? canonicalPositionMap.get(row.type)!
      : trailingPos++;

    if (row.position !== targetPos) {
      tx.update(tabs)
        .set({ position: targetPos })
        .where(eq(tabs.id, row.id))
        .run();
      repositioned++;
    }
  }

  return { inserted, repositioned };
}
