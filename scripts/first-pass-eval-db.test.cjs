/* eslint-disable @typescript-eslint/no-require-imports */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const Database = require("better-sqlite3");
const { loadDatabasePairs } = require("./first-pass-eval.cjs");

const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "anw-first-pass-eval-"));
const dbFile = path.join(temporary, "fixture.db");
const manifestFile = path.join(temporary, "manifest.json");
const db = new Database(dbFile);
try {
  db.exec(`
    create table content_export_events (
      id text, document_id text, export_id text, created_at integer,
      episode_number integer, section_uid text, snapshot_id text,
      generation_run_id text, text_hash text, match_reason text
    );
    create table content_text_snapshots (
      id text, document_id text, snapshot_kind text, generation_run_id text,
      episode_number integer, created_at integer, text_raw text, text_hash text,
      match_reason text
    );
  `);
  const insertSnapshot = db.prepare("insert into content_text_snapshots values (?, ?, ?, ?, ?, ?, ?, ?, ?)");
  insertSnapshot.run("first", "doc", "first_generation", "run", 1, 100, 'A: "Go."', "first-hash", null);
  insertSnapshot.run("final", "doc", "final_export", "run", 1, 110, 'A: "Run."', "final-hash", null);
  insertSnapshot.run("bad-final", "doc", "final_export", "run2", 2, 110, 'A: "Stay."', "other-hash", null);
  const insertExport = db.prepare("insert into content_export_events values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)");
  insertExport.run("event", "doc", "export", 120, 1, "section", "final", "run", "final-hash", null);
  insertExport.run("bad-event", "doc", "bad-export", 120, 2, "section2", "bad-final", "run2", "mismatch", null);
} finally {
  db.close();
}
fs.writeFileSync(manifestFile, JSON.stringify({
  documentId: "doc", exportIds: ["export", "bad-export"], cutoff: "1970-01-01T00:03:00Z",
}));
const result = loadDatabasePairs(dbFile, manifestFile);
assert.equal(result.pairs.length, 1);
assert.equal(result.pairs[0].firstId, "first");
assert.equal(result.pairs[0].finalId, "final");
assert.equal(result.excluded[0].reason, "export_final_hash_mismatch");
// Remove only the unique OS-temp directory created by this test.
assert.equal(path.dirname(temporary), os.tmpdir());
fs.rmSync(temporary, { recursive: true, force: true });
console.log("first-pass-eval database test passed");
