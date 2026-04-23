// Pre-heal audit: scan every document in the DB and report what each one
// needs before the fixed-tab-structure heal runs on it. Runs read-only —
// writes nothing. Output is JSON to stdout so a reviewer can eyeball it or
// pipe it to `jq`.
//
//   DATABASE_PATH=./data/writer.db npx tsx scripts/audit-tabs.ts > audit.json
//
// Per doc, the report records:
//   - legacyTypes: tabs still carrying episode_plot / reference_episode /
//     research — these will be renamed in place by heal.
//   - missingCanonical: which of the five canonical tab types are absent —
//     heal will insert them with the skeleton content from canonical-tabs.
//   - hasAdaptationState: whether series_overview body contains [H2]
//     Adaptation State — heal will lift it into Workbook.
//   - literalTagLeak: paragraphs whose text begins with "[P]" / "[UL]" /
//     "[H1]" / etc., which indicates the Editor.tsx parse bug dropped a
//     literal tag into content. Phase B's parser fix stops new leaks;
//     existing rot stays until the writer edits those blocks or Format is
//     run on them.

import { db } from "../src/lib/db";
import { documents, tabs } from "../src/lib/db/schema";
import { eq } from "drizzle-orm";

interface TiptapNode {
  type?: string;
  attrs?: { level?: number } & Record<string, unknown>;
  content?: TiptapNode[];
  text?: string;
}

function textOf(n: TiptapNode): string {
  if (typeof n.text === "string") return n.text;
  if (!n.content) return "";
  return n.content.map(textOf).join("");
}

function hasAdaptationState(contentStr: string | null): boolean {
  if (!contentStr) return false;
  try {
    const doc = JSON.parse(contentStr) as TiptapNode;
    const children = Array.isArray(doc.content) ? doc.content : [];
    return children.some(
      (n) =>
        n.type === "heading" &&
        n.attrs?.level === 2 &&
        textOf(n).trim().toLowerCase() === "adaptation state"
    );
  } catch {
    return false;
  }
}

function literalTagLeakSamples(contentStr: string | null): string[] {
  if (!contentStr) return [];
  try {
    const doc = JSON.parse(contentStr) as TiptapNode;
    const leaks: string[] = [];
    const walk = (n: TiptapNode) => {
      if (n.type === "paragraph") {
        const t = textOf(n).trim();
        if (/^\[[A-Z0-9_-]+\]\s/i.test(t)) {
          leaks.push(t.slice(0, 80));
        }
      }
      if (n.content) for (const c of n.content) walk(c);
    };
    if (doc.content) for (const c of doc.content) walk(c);
    return leaks.slice(0, 5); // cap so the report stays legible
  } catch {
    return [];
  }
}

const CANONICAL_TYPES = [
  "series_overview",
  "characters",
  "microdrama_plots",
  "predefined_episodes",
  "workbook",
] as const;

const LEGACY_TYPES = new Set(["episode_plot", "reference_episode", "research"]);

async function main() {
  const docs = await db
    .select({ id: documents.id, title: documents.title })
    .from(documents);

  const report = [];
  for (const d of docs) {
    const rows = await db
      .select()
      .from(tabs)
      .where(eq(tabs.documentId, d.id));

    const legacyTypes = rows
      .filter((r) => LEGACY_TYPES.has(r.type))
      .map((r) => ({ tabId: r.id, type: r.type, title: r.title }));

    const presentTypes = new Set(rows.map((r) => r.type));
    // Post-heal equivalence: existing episode_plot covers the
    // microdrama_plots slot, reference_episode covers predefined_episodes.
    if (presentTypes.has("episode_plot")) presentTypes.add("microdrama_plots");
    if (presentTypes.has("reference_episode"))
      presentTypes.add("predefined_episodes");
    const missingCanonical = CANONICAL_TYPES.filter(
      (t) => !presentTypes.has(t)
    );

    const overviewTab = rows.find((r) => r.type === "series_overview");
    const adaptationInOverview = overviewTab
      ? hasAdaptationState(overviewTab.content)
      : false;

    const leakSamples: { tabId: string; title: string; samples: string[] }[] = [];
    for (const r of rows) {
      const samples = literalTagLeakSamples(r.content);
      if (samples.length > 0)
        leakSamples.push({ tabId: r.id, title: r.title, samples });
    }

    report.push({
      docId: d.id,
      title: d.title,
      tabCount: rows.length,
      legacyTypes,
      missingCanonical,
      hasAdaptationState: adaptationInOverview,
      literalTagLeak: leakSamples,
    });
  }

  console.log(JSON.stringify(report, null, 2));
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
