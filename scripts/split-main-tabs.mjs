// Usage:
//   node scripts/split-main-tabs.mjs <db-path> [--dry]
//
// Splits every document's single "Main" tab (created by migration 0002) into
// per-section typed tabs by walking the Tiptap JSON for [H2] section markers.
// Produces ONE tab per [H2] — including a single "Reference Episodes" tab
// that keeps every [H3] Episode N inside it (nested outline is rendered by
// TabRail from those [H3] headings). Likewise a single "Episode Plots" tab.
//
// The original Main tab is RETAINED as "Main (archive)" at position 0 so
// writers have a safety net — they delete it via the UI when satisfied.
//
// Rerunning is idempotent + self-healing:
//   - If a doc has only a fresh Main tab, splits it normally.
//   - If a doc already has a "(archive)" tab plus split results, deletes
//     all non-archive tabs and re-splits from the archive. This lets us
//     iterate the splitter without manual DB cleanup.
//
// With --dry, prints the plan without writing.

import Database from "better-sqlite3";
import process from "node:process";
import crypto from "node:crypto";

const [, , dbPath, ...flags] = process.argv;
const dry = flags.includes("--dry");

if (!dbPath) {
  console.error("Usage: node scripts/split-main-tabs.mjs <db-path> [--dry]");
  process.exit(1);
}

// ───────── inlined: tab type inference ─────────
function inferTabType(rawTitle) {
  const t = (rawTitle || "").trim().toLowerCase();
  if (/^reference\s*episodes?\b/.test(t)) return { type: "reference_episode", sequenceNumber: null };
  if (/^series\s*overview\b/.test(t) || /^overview\b/.test(t)) return { type: "series_overview", sequenceNumber: null };
  if (/^characters?\b/.test(t) || /^cast\b/.test(t)) return { type: "characters", sequenceNumber: null };
  if (/^episode\s*plots?\b/.test(t) || /^plots?\b/.test(t)) return { type: "episode_plot", sequenceNumber: null };
  if (/^research\b/.test(t) || /^original\s*(story|plotline)\b/.test(t) || /^source\b/.test(t)) return { type: "research", sequenceNumber: null };
  return { type: "custom", sequenceNumber: null };
}

// ───────── inlined: splitter ─────────
function nodeText(node) {
  if (typeof node?.text === "string") return node.text;
  if (!node?.content) return "";
  return node.content.map(nodeText).join("");
}
function serialise(nodes) {
  return JSON.stringify({ type: "doc", content: nodes });
}
function h1Node(title) {
  return { type: "heading", attrs: { level: 1 }, content: [{ type: "text", text: title }] };
}

function splitTiptapDocument(rawContent) {
  if (!rawContent) return [];
  let doc;
  try { doc = JSON.parse(rawContent); } catch { return []; }
  const children = Array.isArray(doc.content) ? doc.content : [];
  if (children.length === 0) return [];

  const sections = [];
  const preludeNodes = [];
  let curTitle = null;
  let curNodes = [];

  const flushSection = () => {
    if (!curTitle) return;
    const inferred = inferTabType(curTitle);
    const body = [h1Node(curTitle), ...curNodes];
    sections.push({
      title: curTitle,
      type: inferred.type,
      sequenceNumber: null,
      content: serialise(body),
    });
    curTitle = null;
    curNodes = [];
  };

  for (const node of children) {
    const isH2 = node.type === "heading" && node.attrs?.level === 2;
    if (isH2) {
      flushSection();
      curTitle = nodeText(node).trim();
      continue;
    }
    if (curTitle) curNodes.push(node);
    else preludeNodes.push(node);
  }
  flushSection();

  if (preludeNodes.length > 0) {
    const overviewIdx = sections.findIndex((s) => s.type === "series_overview");
    if (overviewIdx >= 0) {
      const existing = JSON.parse(sections[overviewIdx].content).content;
      const [h1, ...rest] = existing;
      sections[overviewIdx] = {
        ...sections[overviewIdx],
        content: serialise([h1, ...preludeNodes, ...rest]),
      };
    } else {
      sections.unshift({
        title: "Series Overview",
        type: "series_overview",
        sequenceNumber: null,
        content: serialise([h1Node("Series Overview"), ...preludeNodes]),
      });
    }
  }

  return sections;
}

function shouldSplit(rawContent) {
  if (!rawContent) return false;
  try {
    const doc = JSON.parse(rawContent);
    const children = doc.content || [];
    const h2s = children.filter((n) => n.type === "heading" && n.attrs?.level === 2);
    return h2s.length >= 2;
  } catch { return false; }
}

// ───────── script body ─────────
const db = new Database(dbPath, { fileMustExist: true });
db.pragma("journal_mode = WAL");

const docs = db.prepare(`SELECT id, title FROM documents`).all();
console.log(`\nDB: ${dbPath}${dry ? " (DRY RUN)" : ""}`);
console.log(`Found ${docs.length} document(s)\n`);

const insertTab = db.prepare(`
  INSERT INTO tabs (id, document_id, title, type, sequence_number, content, position, created_at, updated_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
`);
const updateActiveTab = db.prepare(`UPDATE documents SET active_tab_id = ? WHERE id = ?`);
const demoteTab = db.prepare(
  `UPDATE tabs SET title = ?, position = ?, updated_at = ? WHERE id = ?`
);
const deleteTabById = db.prepare(`DELETE FROM tabs WHERE id = ?`);
const getTabsForDoc = db.prepare(
  `SELECT id, title, type, content, length(content) AS len FROM tabs WHERE document_id = ? ORDER BY position`
);

function nanoid() { return crypto.randomBytes(6).toString("hex"); }
function nowSec() { return Math.floor(Date.now() / 1000); }

let totalSplit = 0;
let totalSkipped = 0;

for (const doc of docs) {
  const tabsForDoc = getTabsForDoc.all(doc.id);
  console.log(`── ${doc.id} "${doc.title}" — ${tabsForDoc.length} tab(s)`);

  // Locate the seed: either the fresh Main tab OR an existing archive.
  let seedTab = null;
  let nonArchiveTabIds = [];

  if (tabsForDoc.length === 1 && !/\(archive\)/i.test(tabsForDoc[0].title)) {
    seedTab = tabsForDoc[0]; // fresh Main
  } else {
    const archive = tabsForDoc.find((t) => /\(archive\)/i.test(t.title));
    if (archive) {
      seedTab = archive;
      nonArchiveTabIds = tabsForDoc
        .filter((t) => t.id !== archive.id)
        .map((t) => t.id);
    }
  }

  if (!seedTab) {
    console.log(`   SKIP: no Main/archive seed tab found`);
    totalSkipped++;
    continue;
  }
  if (!seedTab.content) {
    console.log(`   SKIP: seed tab has no content`);
    totalSkipped++;
    continue;
  }
  if (!shouldSplit(seedTab.content)) {
    console.log(`   SKIP: seed has <2 [H2] sections — keeping as single tab`);
    totalSkipped++;
    continue;
  }

  const sections = splitTiptapDocument(seedTab.content);
  if (sections.length === 0) {
    console.log(`   SKIP: splitter produced 0 sections`);
    totalSkipped++;
    continue;
  }

  console.log(`   PLAN:`);
  console.log(`     [pos 0] Main (archive)  [retained]`);
  sections.forEach((s, i) => {
    const bytes = Buffer.byteLength(s.content, "utf8");
    console.log(`     [pos ${i + 1}] "${s.title}" (${s.type}) — ${bytes} bytes`);
  });
  if (nonArchiveTabIds.length > 0) {
    console.log(`     (clearing ${nonArchiveTabIds.length} previously-split tab(s))`);
  }

  if (dry) continue;

  const tx = db.transaction(() => {
    const ts = nowSec();
    // 1. Clear any previously-split tabs (re-run case).
    for (const id of nonArchiveTabIds) deleteTabById.run(id);
    // 2. Demote seed to "Main (archive)" at position 0 (first in rail).
    const archiveTitle = /\(archive\)/i.test(seedTab.title) ? seedTab.title : `${seedTab.title} (archive)`;
    demoteTab.run(archiveTitle, 0, ts, seedTab.id);
    // 3. Insert new typed tabs at positions 1..N.
    const newIds = [];
    sections.forEach((s, i) => {
      const id = nanoid();
      newIds.push(id);
      insertTab.run(id, doc.id, s.title, s.type, s.sequenceNumber, s.content, i + 1, ts, ts);
    });
    // 4. First real content tab becomes active.
    if (newIds[0]) updateActiveTab.run(newIds[0], doc.id);
  });
  tx();
  totalSplit++;
  console.log(`   ✓ committed — archive first, ${sections.length} typed tabs`);
}

console.log(`\nSummary: split=${totalSplit} skipped=${totalSkipped}${dry ? " (dry)" : ""}\n`);
db.close();
