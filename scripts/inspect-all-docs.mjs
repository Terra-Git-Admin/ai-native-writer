import Database from "better-sqlite3";

const DB_PATH = "C:/Users/vikas/AppData/Local/Temp/writer-db-snapshot/writer.db";
const db = new Database(DB_PATH, { readonly: true, fileMustExist: true });

const CUTOFF = Math.floor(new Date("2026-04-24T05:06:24Z").getTime() / 1000);
console.log(`CUTOFF = 2026-04-24T05:06:24Z (main .db last flush)`);
console.log(`Any tab with updated_at > CUTOFF is likely lost\n`);

const all = db.prepare(`
  SELECT t.id as tab_id, t.document_id, t.type, t.title, t.updated_at,
         length(t.content) as content_len, d.title as doc_title
  FROM tabs t
  JOIN documents d ON d.id = t.document_id
  ORDER BY t.updated_at DESC
`).all();

console.log("=== Most-recently-updated tabs across all docs ===");
for (const t of all.slice(0, 30)) {
  const lost = t.updated_at > CUTOFF ? " (AFTER CUTOFF — may have lost newer writes)" : "";
  console.log(
    `${new Date(t.updated_at * 1000).toISOString()}  ` +
    `doc="${t.doc_title}" (${t.document_id})  ` +
    `tab="${t.title}" (${t.tab_id}, ${t.type})  ` +
    `${t.content_len ?? 0}b${lost}`
  );
}

console.log("\n=== Count of version snapshots by date ===");
const byDate = db.prepare(`
  SELECT date(created_at, 'unixepoch') as d, COUNT(*) as n
  FROM document_versions
  GROUP BY d
  ORDER BY d DESC
  LIMIT 10
`).all();
for (const r of byDate) console.log(r);

console.log("\n=== Today's version snapshots still in DB ===");
const TODAY_START = Math.floor(new Date("2026-04-24T00:00:00Z").getTime() / 1000);
const todayVersions = db.prepare(`
  SELECT v.id, v.document_id, v.tab_id, v.created_at, length(v.content) as len
  FROM document_versions v
  WHERE v.created_at >= ?
  ORDER BY v.created_at DESC
`).all(TODAY_START);
for (const v of todayVersions) {
  console.log(`${new Date(v.created_at * 1000).toISOString()}  doc=${v.document_id}  tab=${v.tab_id}  ${v.len}b`);
}
console.log(`Total today snapshots in DB: ${todayVersions.length}`);

db.close();
