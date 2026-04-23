// The five fixed tabs every document carries. Seeded on doc create and
// healed into place for legacy docs on first tab fetch. Protected: title
// and type cannot be edited, row cannot be deleted, order is locked.
//
// Writers can add custom tabs alongside these five; custom tabs are
// unprotected and live at positions >= 5.

import { nanoid } from "nanoid";
import type { InferInsertModel } from "drizzle-orm";
import { tabs } from "./db/schema";

export type CanonicalTabType =
  | "series_overview"
  | "characters"
  | "microdrama_plots"
  | "predefined_episodes"
  | "workbook";

export interface CanonicalTabSpec {
  type: CanonicalTabType;
  title: string;
  position: number;
  // Tiptap doc JSON string. `null` renders a blank editor.
  content: string | null;
}

function h1(text: string) {
  return {
    type: "heading",
    attrs: { textAlign: null, level: 1 },
    content: [{ type: "text", text }],
  };
}

function h2(text: string) {
  return {
    type: "heading",
    attrs: { textAlign: null, level: 2 },
    content: [{ type: "text", text }],
  };
}

function doc(nodes: object[]): string {
  return JSON.stringify({ type: "doc", content: nodes });
}

// Original Research holds the series summary and logline at the top of the
// body, then an `Original Episodes` section. Writers fill each `[H3] Episode N`
// under that section — TabRail renders those H3s as the nested outline for
// this tab.
const originalResearchSkeleton = doc([
  h1("Original Research"),
  h2("Summary"),
  h2("Logline"),
  h2("Original Episodes"),
]);

export const CANONICAL_TABS: readonly CanonicalTabSpec[] = [
  {
    type: "series_overview",
    title: "Original Research",
    position: 0,
    content: originalResearchSkeleton,
  },
  {
    type: "characters",
    title: "Characters",
    position: 1,
    content: doc([h1("Characters")]),
  },
  {
    type: "microdrama_plots",
    title: "Microdrama Plots",
    position: 2,
    content: doc([h1("Microdrama Plots")]),
  },
  {
    type: "predefined_episodes",
    title: "Predefined Episodes",
    position: 3,
    content: doc([h1("Predefined Episodes")]),
  },
  {
    // Workbook is blank until the writer triggers adaptation-state generation
    // from the AI sidebar (wired in Phase D). Writers can also edit manually.
    type: "workbook",
    title: "Workbook",
    position: 4,
    content: null,
  },
];

export const CANONICAL_TAB_TYPES: readonly CanonicalTabType[] =
  CANONICAL_TABS.map((t) => t.type);

type TabInsert = InferInsertModel<typeof tabs>;

// Build insert rows for all five canonical tabs bound to a document. Caller
// is responsible for the actual db.insert — this keeps the seeding logic
// reusable between new-doc create (POST /api/documents) and legacy-doc heal
// (GET /api/documents/[id]/tabs).
export function buildCanonicalTabRows(
  documentId: string,
  now: Date = new Date()
): { rows: TabInsert[]; firstTabId: string } {
  let firstTabId: string | null = null;
  const rows: TabInsert[] = CANONICAL_TABS.map((spec) => {
    const id = nanoid(12);
    if (firstTabId === null) firstTabId = id;
    return {
      id,
      documentId,
      title: spec.title,
      type: spec.type,
      sequenceNumber: null,
      content: spec.content,
      position: spec.position,
      isProtected: true,
      createdAt: now,
      updatedAt: now,
    };
  });
  return { rows, firstTabId: firstTabId! };
}
