import Database from "better-sqlite3";

const DB_PATH = "C:/Users/vikas/AppData/Local/Temp/writer-db-snapshot/writer.db";
const DOC_ID = "-sFrxtZgUg32";
const TAB_ID = "8MJAque3MO3o";

const db = new Database(DB_PATH, { readonly: true, fileMustExist: true });

function sha(s) {
  // match the app's contentHash — cheap hash of string (base36)
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) - h + s.charCodeAt(i)) | 0;
  }
  return Math.abs(h).toString(36);
}

console.log("=== Current tabs row ===");
const tab = db
  .prepare("SELECT id, document_id, title, type, position, is_protected, created_at, updated_at, length(content) as content_len FROM tabs WHERE id = ? AND document_id = ?")
  .get(TAB_ID, DOC_ID);
console.log(tab);

if (tab) {
  const content = db.prepare("SELECT content FROM tabs WHERE id = ? AND document_id = ?").get(TAB_ID, DOC_ID).content;
  console.log("content_hash:", sha(content || ""));
  console.log("updated_at (unix):", tab.updated_at, "=>", new Date(tab.updated_at * 1000).toISOString());
}

console.log("\n=== document_versions for this tab (newest first) ===");
const versions = db
  .prepare(
    `SELECT id, tab_id, created_at, length(content) as content_len, created_by
     FROM document_versions
     WHERE document_id = ? AND tab_id = ?
     ORDER BY created_at DESC
     LIMIT 30`
  )
  .all(DOC_ID, TAB_ID);
for (const v of versions) {
  const c = db.prepare("SELECT content FROM document_versions WHERE id = ?").get(v.id).content;
  console.log({
    id: v.id,
    len: v.content_len,
    hash: sha(c || ""),
    created_at: new Date(v.created_at * 1000).toISOString(),
    created_by: v.created_by,
  });
}

console.log("\n=== ALL tabs rows for this doc ===");
const allTabs = db
  .prepare("SELECT id, title, type, position, is_protected, length(content) as content_len, updated_at FROM tabs WHERE document_id = ? ORDER BY position")
  .all(DOC_ID);
for (const t of allTabs) {
  console.log({
    id: t.id,
    type: t.type,
    title: t.title,
    pos: t.position,
    protected: t.is_protected,
    content_len: t.content_len,
    updated_at: new Date(t.updated_at * 1000).toISOString(),
  });
}

console.log("\n=== Last 10 document_versions across ALL tabs of this doc ===");
const anyVersions = db
  .prepare(
    `SELECT id, tab_id, length(content) as content_len, created_at
     FROM document_versions
     WHERE document_id = ?
     ORDER BY created_at DESC
     LIMIT 10`
  )
  .all(DOC_ID);
for (const v of anyVersions) {
  console.log({
    id: v.id,
    tab_id: v.tab_id,
    len: v.content_len,
    created_at: new Date(v.created_at * 1000).toISOString(),
  });
}

db.close();
