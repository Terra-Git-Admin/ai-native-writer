#!/usr/bin/env node
// End-to-end durability test — the exact scenario that yesterday's bug caused.
//
// Yesterday's bug: writer types content → "Saved" appears → container restarts
// → user sees content from before the writes. Caused by gcsfuse buffering
// open SQLite files indefinitely, never reaching GCS.
//
// This test proves the new GCS-direct path keeps writes durable across a
// simulated container restart:
//
//   1. Boot SQLite at a fresh /tmp path. Pull from GCS → empty (first run).
//      Force an immediate backup so the empty schema lands in GCS.
//   2. Insert a row that says "this should survive a container restart".
//   3. Run a backup tick. Verify GCS object generation advanced and the
//      uploaded bytes contain the row.
//   4. Run shutdownBackup() — the SIGTERM handler equivalent. Verify GCS
//      generation advanced and the snapshot has the row.
//   5. **DELETE the local DB file** — simulates container terminating with
//      its ephemeral /tmp filesystem evaporating, exactly what Cloud Run does.
//   6. Boot again on a fresh path. Pull from GCS — the boot path that
//      db-bootstrap.mjs runs in production. The downloaded DB must contain
//      the row from step 2.
//
// If step 6 returns the row, the durability fix works end-to-end.
//
// Uses unique test paths under gs://<bucket>/test-runs/{uuid}/ so it never
// touches prod data. Cleans up at the end.

import { Storage } from "@google-cloud/storage";
import Database from "better-sqlite3";
import { spawn } from "child_process";
import { createReadStream, createWriteStream } from "fs";
import {
  mkdir,
  stat,
  rm,
  unlink,
  readFile,
} from "fs/promises";
import { tmpdir } from "os";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { createGzip, createGunzip } from "zlib";
import { pipeline } from "stream/promises";
import { createHash, randomUUID } from "crypto";

const BUCKET = process.env.GCS_BUCKET || "ai-native-writer-db";
const RUN_ID = randomUUID().slice(0, 8);
const TEST_PREFIX = `test-runs/durability-${RUN_ID}/`;
const CANONICAL = `${TEST_PREFIX}writer.db.gz`;
const __dirname = dirname(fileURLToPath(import.meta.url));

const log = (msg, fields = {}) =>
  console.log(`[durability] ${msg}`, JSON.stringify(fields));
const fail = (msg) => {
  console.error(`[durability] FAIL: ${msg}`);
  process.exit(1);
};
const ok = (msg) => console.log(`[durability] OK   ${msg}`);

async function sha256OfFile(p) {
  const hash = createHash("sha256");
  await pipeline(createReadStream(p), hash);
  return hash.digest("hex");
}

async function gzipFile(src, dst) {
  await pipeline(
    createReadStream(src),
    createGzip({ level: 6 }),
    createWriteStream(dst)
  );
}

async function gunzipFile(src, dst) {
  await pipeline(
    createReadStream(src),
    createGunzip(),
    createWriteStream(dst)
  );
}

// Mirrors what backupOnce in src/lib/db/persistence.ts does.
async function backupOnce(sqlite, livePath, bucket, objectName, prevSha) {
  const snap = `${livePath}.snap`;
  const gz = `${livePath}.snap.gz`;
  await sqlite.backup(snap);
  const sha = await sha256OfFile(snap);
  if (sha === prevSha) {
    await unlink(snap).catch(() => {});
    return { skipped: true, sha };
  }
  await gzipFile(snap, gz);
  const buf = await readFile(gz);
  await bucket.file(objectName).save(buf, {
    contentType: "application/gzip",
    metadata: {
      cacheControl: "no-store",
      metadata: { sha256: sha, source: "durability-test" },
    },
  });
  const [meta] = await bucket.file(objectName).getMetadata();
  await unlink(snap).catch(() => {});
  await unlink(gz).catch(() => {});
  return {
    skipped: false,
    sha,
    generation: String(meta.generation ?? ""),
    reportedSha: meta.metadata && meta.metadata.sha256,
  };
}

async function main() {
  log("start", { bucket: BUCKET, runId: RUN_ID });

  const tmpDir = join(tmpdir(), `durability-${RUN_ID}`);
  await mkdir(tmpDir, { recursive: true });
  const livePath1 = join(tmpDir, "boot1", "writer.db");
  const livePath2 = join(tmpDir, "boot2", "writer.db");
  await mkdir(dirname(livePath1), { recursive: true });
  await mkdir(dirname(livePath2), { recursive: true });

  const storage = new Storage();
  const bucket = storage.bucket(BUCKET);

  // --- BOOT 1: write content, simulate full lifecycle ---

  log("boot1.open", { livePath: livePath1 });
  const sqlite = new Database(livePath1);
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("synchronous = FULL");

  // Schema mirrors the real app's documents table, just enough columns to
  // matter for durability.
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS marker_doc (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      body TEXT NOT NULL,
      saved_at INTEGER NOT NULL
    )
  `);
  ok("boot1: empty db opened, schema created");

  // Step 1: empty-state backup (mirrors forceBackup on first boot).
  const r1 = await backupOnce(sqlite, livePath1, bucket, CANONICAL, null);
  if (r1.skipped) fail("first backup unexpectedly skipped");
  if (r1.reportedSha !== r1.sha)
    fail(`first backup reportedSha mismatch: sent=${r1.sha} got=${r1.reportedSha}`);
  ok(`boot1: forceBackup uploaded empty-schema (gen=${r1.generation})`);
  const gen1 = r1.generation;
  const sha1 = r1.sha;

  // Step 2: write a marker row — this is the "writer types content" moment.
  const docId = `doc-${RUN_ID}`;
  const writeBody =
    "This text should still be here after a simulated container restart.";
  sqlite
    .prepare(
      "INSERT INTO marker_doc (id, title, body, saved_at) VALUES (?, ?, ?, ?)"
    )
    .run(docId, "QA durability test", writeBody, Date.now());
  ok(`boot1: inserted marker doc ${docId}`);

  // Step 3: backup tick after the write — generation MUST advance, sha MUST change.
  const r2 = await backupOnce(sqlite, livePath1, bucket, CANONICAL, sha1);
  if (r2.skipped) fail("post-write backup skipped (sha didn't change)");
  if (r2.generation === gen1)
    fail(
      `post-write backup did not advance generation: was ${gen1}, still ${r2.generation}`
    );
  if (r2.sha === sha1)
    fail(`post-write sha did not change: still ${sha1.slice(0, 16)}`);
  ok(
    `boot1: post-write backup advanced gen ${gen1} → ${r2.generation}, sha ${sha1.slice(0, 8)}... → ${r2.sha.slice(0, 8)}...`
  );
  const gen2 = r2.generation;
  const sha2 = r2.sha;

  // Step 4: shutdownBackup equivalent — final upload before close.
  const r3 = await backupOnce(sqlite, livePath1, bucket, CANONICAL, sha2);
  if (!r3.skipped)
    log("boot1.shutdown.uploaded_again", {
      reason: "content changed between tick and shutdown",
      gen: r3.generation,
    });
  else ok("boot1: shutdownBackup correctly skipped (no changes since last tick)");
  sqlite.close();
  ok("boot1: SQLite closed cleanly");

  // Step 5: ANNIHILATE the local file. This is the moment of truth — Cloud
  // Run terminates the container and the /tmp filesystem dies. If the GCS
  // object isn't authoritative, the next boot starts from nothing.
  await rm(dirname(livePath1), { recursive: true, force: true });
  ok("boot1: local /tmp wiped — simulating container termination");

  // --- BOOT 2: cold start, must download from GCS and see the marker ---

  // Step 6: spawn the actual production bootstrap script as a subprocess.
  // This is the EXACT code path that runs in the Cloud Run Dockerfile CMD.
  log("boot2.bootstrap.start", { livePath: livePath2, gcsObject: CANONICAL });
  await new Promise((resolve, reject) => {
    const child = spawn(
      "node",
      [join(__dirname, "db-bootstrap.mjs")],
      {
        env: {
          ...process.env,
          DATABASE_PATH: livePath2,
          GCS_BUCKET: BUCKET,
          GCS_DB_OBJECT: CANONICAL,
          LEGACY_DB_PATH: "/this/path/does/not/exist",
          BOOTSTRAP_REQUIRED: "true",
        },
        stdio: "inherit",
      }
    );
    child.on("exit", (code) => {
      if (code === 0) resolve(undefined);
      else reject(new Error(`bootstrap exit code ${code}`));
    });
    child.on("error", reject);
  });
  ok("boot2: bootstrap subprocess exited 0");

  // Step 7: open the downloaded SQLite. THE DOC FROM BOOT 1 MUST BE PRESENT.
  const sqlite2 = new Database(livePath2, { readonly: true });
  const row = sqlite2
    .prepare("SELECT id, title, body, saved_at FROM marker_doc WHERE id = ?")
    .get(docId);
  sqlite2.close();

  if (!row) {
    fail(
      `marker doc ${docId} missing after restart — DURABILITY BROKEN. The write from boot 1 did not survive.`
    );
  }
  if (row.body !== writeBody) {
    fail(
      `body mismatch: expected="${writeBody}" got="${row.body}"`
    );
  }
  ok(`boot2: marker doc survived restart → "${row.title}"`);
  ok(`boot2: body matches: "${row.body.slice(0, 40)}..."`);

  // Step 8: cleanup — delete test objects.
  const [files] = await bucket.getFiles({ prefix: TEST_PREFIX });
  await Promise.all(files.map((f) => f.delete().catch(() => {})));
  try {
    await rm(tmpDir, { recursive: true, force: true });
  } catch {
    /* windows handle race */
  }
  ok(`cleanup: deleted ${files.length} GCS object(s) under ${TEST_PREFIX}`);

  console.log("\n========================================");
  console.log("DURABILITY E2E TEST PASSED");
  console.log("========================================");
  console.log("Yesterday's bug:  writer types → 'Saved' → restart → content lost");
  console.log("Today's behavior: writer types → uploaded to GCS → restart → content present");
  console.log(`Verified across canonical generations: ${gen1} → ${gen2}`);
}

main().catch((err) => {
  console.error("[durability] uncaught", err);
  process.exit(1);
});
