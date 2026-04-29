import Database from "better-sqlite3";
import fs from "node:fs";

const DIR = "C:/Users/vikas/AppData/Local/Temp/writer-db-rw";
const DB_PATH = `${DIR}/writer.db`;

// Inspect raw WAL header before opening
const wal = fs.readFileSync(`${DIR}/writer.db-wal`);
const walHeader = {
  magic: wal.readUInt32BE(0).toString(16),
  fileFormat: wal.readUInt32BE(4),
  pageSize: wal.readUInt32BE(8),
  checkpointSeqNo: wal.readUInt32BE(12),
  salt1: wal.readUInt32BE(16).toString(16),
  salt2: wal.readUInt32BE(20).toString(16),
  checksum1: wal.readUInt32BE(24).toString(16),
  checksum2: wal.readUInt32BE(28).toString(16),
};
console.log("=== WAL header (raw bytes) ===");
console.log(walHeader);
console.log(`WAL file size: ${wal.length} bytes (${wal.length - 32} bytes of frame data)`);
console.log(`Frame size = pageSize (${walHeader.pageSize}) + 24-byte header`);
const frameSize = walHeader.pageSize + 24;
const frameCount = Math.floor((wal.length - 32) / frameSize);
console.log(`Implied frame count: ${frameCount}`);

// Walk frames and check for frames that contain the tab row's contentHash-like patterns
console.log(`\n=== Scanning WAL frames for identifiable SQL text ===`);
let framesWithTabContent = 0;
for (let i = 0; i < frameCount; i++) {
  const frameStart = 32 + i * frameSize;
  const pageNumber = wal.readUInt32BE(frameStart);
  const commitSize = wal.readUInt32BE(frameStart + 4);
  const framePage = wal.subarray(frameStart + 24, frameStart + 24 + walHeader.pageSize);
  // Simple heuristic: if the page contains the string "8MJAque3MO3o" (the tab id)
  // OR our known content hash markers, flag it
  const text = framePage.toString("binary");
  if (text.includes("8MJAque3MO3o") || text.includes("Microdrama Plots")) {
    framesWithTabContent++;
    if (framesWithTabContent <= 5) {
      console.log(`  Frame ${i} (page ${pageNumber}, commit=${commitSize}): contains tab marker`);
    }
  }
}
console.log(`Total WAL frames mentioning '8MJAque3MO3o' or 'Microdrama Plots': ${framesWithTabContent}`);

// Now open DB with better-sqlite3 (read-write, NOT readonly) so WAL is applied properly
console.log(`\n=== Opening DB read-write and querying with WAL attached ===`);
const db = new Database(DB_PATH, { readonly: false, fileMustExist: true });

console.log("PRAGMA journal_mode:", db.pragma("journal_mode", { simple: true }));
console.log("PRAGMA synchronous:", db.pragma("synchronous", { simple: true }));
console.log("PRAGMA wal_autocheckpoint:", db.pragma("wal_autocheckpoint", { simple: true }));
console.log("PRAGMA user_version:", db.pragma("user_version", { simple: true }));
console.log("PRAGMA schema_version:", db.pragma("schema_version", { simple: true }));
console.log("PRAGMA integrity_check:", db.pragma("integrity_check", { simple: true }));

// Before checkpoint: what does the tab row look like?
const preRow = db
  .prepare("SELECT id, length(content) as len, updated_at FROM tabs WHERE id = ?")
  .get("8MJAque3MO3o");
console.log("\nBEFORE checkpoint — tab row:", preRow);

// Get WAL checkpoint status
const chkInfo = db.pragma("wal_checkpoint(PASSIVE)");
console.log("\nwal_checkpoint(PASSIVE) result:", chkInfo);
// Returns [busy, log_pages, checkpointed_pages]

const postRow = db
  .prepare("SELECT id, length(content) as len, updated_at FROM tabs WHERE id = ?")
  .get("8MJAque3MO3o");
console.log("AFTER checkpoint — tab row:", postRow);

// How many document_versions for this tab now?
const vCount = db
  .prepare("SELECT COUNT(*) as n, MAX(created_at) as latest FROM document_versions WHERE document_id = ? AND tab_id = ?")
  .get("-sFrxtZgUg32", "8MJAque3MO3o");
console.log("document_versions for this tab:", vCount, "latest:", vCount.latest ? new Date(vCount.latest * 1000).toISOString() : "none");

// Final — check all today's version snapshots in DB
const today = Math.floor(new Date("2026-04-24T00:00:00Z").getTime() / 1000);
const todayCount = db.prepare("SELECT COUNT(*) as n FROM document_versions WHERE created_at >= ?").get(today);
console.log(`Total version snapshots with created_at >= today 00:00 UTC: ${todayCount.n}`);

db.close();
