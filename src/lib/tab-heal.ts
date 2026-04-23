// Legacy-doc heal: ensure every document has exactly the five canonical
// protected tabs (Original Research, Characters, Microdrama Plots,
// Predefined Episodes, Workbook) at positions 0–4, with any archive tabs
// and custom writer tabs trailing at positions 5+.
//
// This runs on every GET /api/documents/[id]/tabs and is idempotent. Existing
// typed tabs are upgraded in place (type renamed, title normalised,
// isProtected flipped on) so row IDs — referenced by comments and document
// versions — are preserved. Missing canonical slots are filled with skeleton
// content.
//
// Extra behavior on first healing pass:
//   • Legacy `research` tab → renamed to "Research (archive)", type=custom,
//     unprotected. Content is retained untouched; writers can copy useful
//     fragments into Original Research manually.
//   • `[H2] Adaptation State` section → lifted out of Original Research
//     content into the Workbook tab, but only when Workbook content is empty.
//     If the writer has already put work into Workbook, the existing
//     Adaptation State section is left in place (no clobber).

import { and, eq, sql } from "drizzle-orm";
import { nanoid } from "nanoid";
import { db } from "./db";
import { tabs } from "./db/schema";
import { logTrace } from "./saveTrace";
import {
  CANONICAL_TABS,
  type CanonicalTabType,
} from "./canonical-tabs";

interface TiptapNode {
  type?: string;
  attrs?: { level?: number } & Record<string, unknown>;
  content?: TiptapNode[];
  text?: string;
}

interface TabRow {
  id: string;
  documentId: string;
  title: string;
  type: string;
  sequenceNumber: number | null;
  content: string | null;
  position: number;
  isProtected: boolean;
}

function classify(row: TabRow): CanonicalTabType | "research_legacy" | "archive" | "custom" {
  const t = row.type;
  const title = (row.title || "").toLowerCase();
  if (t === "series_overview") return "series_overview";
  if (t === "characters") return "characters";
  if (t === "microdrama_plots" || t === "episode_plot") return "microdrama_plots";
  if (t === "predefined_episodes" || t === "reference_episode") return "predefined_episodes";
  if (t === "workbook") return "workbook";
  if (t === "research") return "research_legacy";
  if (/\(archive\)/i.test(title)) return "archive";
  return "custom";
}

function nodeText(node: TiptapNode): string {
  if (typeof node?.text === "string") return node.text;
  if (!node?.content) return "";
  return node.content.map(nodeText).join("");
}

// Returns [contentWithoutAdaptationState, adaptationStateContent] — each as a
// serialised Tiptap doc, or null if the source had no [H2] Adaptation State.
function extractAdaptationState(
  rawContent: string | null
): { stripped: string; lifted: string } | null {
  if (!rawContent) return null;
  let doc: TiptapNode;
  try {
    doc = JSON.parse(rawContent);
  } catch {
    return null;
  }
  const children = Array.isArray(doc.content) ? doc.content : [];
  if (children.length === 0) return null;

  const startIdx = children.findIndex(
    (n) =>
      n.type === "heading" &&
      n.attrs?.level === 2 &&
      nodeText(n).trim().toLowerCase() === "adaptation state"
  );
  if (startIdx === -1) return null;

  // Section ends at the next [H2] or end of doc.
  let endIdx = children.length;
  for (let i = startIdx + 1; i < children.length; i++) {
    const n = children[i];
    if (n.type === "heading" && n.attrs?.level === 2) {
      endIdx = i;
      break;
    }
  }

  const lifted = children.slice(startIdx, endIdx);
  const stripped = [...children.slice(0, startIdx), ...children.slice(endIdx)];

  // Promote [H2] Adaptation State into [H1] Workbook so the lifted tab has
  // a proper page title and the section heads become H2 subsections.
  const workbookBody: TiptapNode[] = [
    {
      type: "heading",
      attrs: { textAlign: null, level: 1 },
      content: [{ type: "text", text: "Workbook" }],
    },
    ...lifted.slice(1), // drop the original [H2] Adaptation State header
  ];

  return {
    stripped: JSON.stringify({ type: "doc", content: stripped }),
    lifted: JSON.stringify({ type: "doc", content: workbookBody }),
  };
}

function isWorkbookEmpty(content: string | null): boolean {
  if (!content) return true;
  try {
    const doc = JSON.parse(content) as TiptapNode;
    const children = Array.isArray(doc.content) ? doc.content : [];
    // Empty = no children at all, OR only an [H1] title placeholder.
    if (children.length === 0) return true;
    if (
      children.length === 1 &&
      children[0].type === "heading" &&
      children[0].attrs?.level === 1
    ) {
      return true;
    }
    return false;
  } catch {
    return true;
  }
}

export async function healFixedTabs(docId: string): Promise<boolean> {
  const rows = (await db
    .select()
    .from(tabs)
    .where(eq(tabs.documentId, docId))
    .orderBy(tabs.position)) as TabRow[];

  // Don't touch brand-new docs that already have the canonical shape.
  const allAlreadyProtected =
    rows.length >= CANONICAL_TABS.length &&
    CANONICAL_TABS.every((spec) =>
      rows.some(
        (r) => r.type === spec.type && r.isProtected && r.title === spec.title
      )
    );
  if (allAlreadyProtected) return false;

  const canonicalSlot = new Map<CanonicalTabType, TabRow>();
  const researchLegacy: TabRow[] = [];
  const archives: TabRow[] = [];
  const custom: TabRow[] = [];

  for (const r of rows) {
    const cls = classify(r);
    if (cls === "research_legacy") researchLegacy.push(r);
    else if (cls === "archive") archives.push(r);
    else if (cls === "custom") custom.push(r);
    else if (!canonicalSlot.has(cls)) canonicalSlot.set(cls, r);
    else archives.push(r); // duplicate canonical — demote to archive tail
  }

  const now = new Date();
  const touched: { action: string; tabId: string; type?: string }[] = [];

  // Decide whether to lift [H2] Adaptation State from the series_overview
  // tab into the Workbook tab. Only do this if Workbook is empty (or missing).
  const overview = canonicalSlot.get("series_overview");
  const workbookExisting = canonicalSlot.get("workbook");
  let workbookContentOverride: string | null = null;
  let overviewStrippedContent: string | null = null;
  if (overview && isWorkbookEmpty(workbookExisting?.content ?? null)) {
    const extract = extractAdaptationState(overview.content);
    if (extract) {
      workbookContentOverride = extract.lifted;
      overviewStrippedContent = extract.stripped;
      logTrace("tabs.heal.adaptation_lift", {
        docId,
        sourceTabId: overview.id,
        liftedBytes: extract.lifted.length,
      });
    }
  }

  // 1) Upgrade existing canonical tabs in place.
  for (const spec of CANONICAL_TABS) {
    const existing = canonicalSlot.get(spec.type);
    if (!existing) continue;
    const patch: Partial<TabRow> & { updatedAt: Date } = {
      updatedAt: now,
    };
    if (existing.title !== spec.title) patch.title = spec.title;
    // Legacy type names get upgraded to canonical ones.
    if (existing.type !== spec.type) patch.type = spec.type;
    if (!existing.isProtected) patch.isProtected = true;
    if (existing.position !== spec.position) patch.position = spec.position;

    if (spec.type === "series_overview" && overviewStrippedContent !== null) {
      patch.content = overviewStrippedContent;
    }
    if (spec.type === "workbook" && workbookContentOverride !== null) {
      patch.content = workbookContentOverride;
    }

    if (Object.keys(patch).length > 1) {
      await db.update(tabs).set(patch).where(eq(tabs.id, existing.id));
      touched.push({ action: "upgrade", tabId: existing.id, type: spec.type });
      if (patch.type && patch.type !== existing.type) {
        logTrace("tabs.heal.legacy_rename", {
          docId,
          tabId: existing.id,
          from: existing.type,
          to: patch.type,
        });
      }
    }
  }

  // 2) Insert missing canonical tabs.
  for (const spec of CANONICAL_TABS) {
    if (canonicalSlot.has(spec.type)) continue;
    const id = nanoid(12);
    const content =
      spec.type === "workbook" && workbookContentOverride !== null
        ? workbookContentOverride
        : spec.content;
    await db.insert(tabs).values({
      id,
      documentId: docId,
      title: spec.title,
      type: spec.type,
      sequenceNumber: null,
      content,
      position: spec.position,
      isProtected: true,
      createdAt: now,
      updatedAt: now,
    });
    touched.push({ action: "insert", tabId: id, type: spec.type });
    logTrace("tabs.heal.seed_fixed", { docId, tabId: id, type: spec.type });
  }

  // 3) Rename legacy research tabs to archive. Content retained as-is so
  // writers can copy fragments into Original Research manually. The tab
  // type stays "research" so the AI context engine can still pull this as
  // the Original Plotline source until writers migrate content upward into
  // Original Research's [H2] Original Episodes section.
  for (const r of researchLegacy) {
    await db
      .update(tabs)
      .set({
        title: /\(archive\)/i.test(r.title) ? r.title : "Research (archive)",
        isProtected: false,
        updatedAt: now,
      })
      .where(eq(tabs.id, r.id));
    touched.push({ action: "research_archive", tabId: r.id });
    logTrace("tabs.heal.research_archive", { docId, tabId: r.id });
    archives.push(r); // flow into trailing-position list
  }

  // 4) Re-number trailing positions: archives first (5+), then custom tabs
  // in their original relative order. Canonical positions 0–4 are already set.
  const trailing = [...archives, ...custom];
  let pos = CANONICAL_TABS.length;
  for (const r of trailing) {
    if (r.position !== pos) {
      await db
        .update(tabs)
        .set({ position: pos, updatedAt: now })
        .where(eq(tabs.id, r.id));
    }
    pos += 1;
  }

  if (touched.length > 0) {
    logTrace("tabs.heal.fixed", { docId, actions: touched });
    return true;
  }
  return false;
}
