import Database from "better-sqlite3";
import path from "node:path";
import { ensureAdSectionUids } from "../src/lib/ads-catalog.ts";

const apply = process.argv.includes("--apply");
const dbArg = process.argv.find((arg) => arg.startsWith("--db="));
const dbPath = dbArg?.slice("--db=".length) || process.env.DATABASE_PATH || path.join(process.cwd(), "data", "writer.db");
const sqlite = new Database(dbPath);
sqlite.pragma("foreign_keys = ON");

const rows = sqlite.prepare("SELECT id, document_id AS documentId, content FROM tabs WHERE type = 'ads'").all();
const updates = [];
let adsSeen = 0;
for (const row of rows) {
  const prepared = ensureAdSectionUids(row.content);
  adsSeen += prepared.adsSeen;
  if (prepared.changed && prepared.contentJson) updates.push({ id: row.id, content: prepared.contentJson });
}

if (apply && updates.length > 0) {
  const update = sqlite.prepare("UPDATE tabs SET content = ? WHERE id = ?");
  sqlite.transaction(() => {
    for (const row of updates) update.run(row.content, row.id);
  })();
}
sqlite.close();

console.log(JSON.stringify({ mode: apply ? "apply" : "dry-run", dbPath, tabsScanned: rows.length, adsSeen, tabsChanged: updates.length }, null, 2));
if (!apply && updates.length > 0) console.log("Dry run only. Re-run with --apply after reviewing the counts and receiving migration approval.");
