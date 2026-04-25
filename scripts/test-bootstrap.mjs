#!/usr/bin/env node
// Integration test for scripts/db-bootstrap.mjs — the GCS-download step
// that runs in the Dockerfile CMD before Next.js boots.
//
// Flow:
//   1. Make a known SQLite db locally
//   2. Upload it (gzipped, with sha256 metadata) to a test path on GCS
//   3. Delete the local file
//   4. Spawn db-bootstrap.mjs as a subprocess with env vars pointing
//      at the test path + a fresh DATABASE_PATH
//   5. Verify the downloaded file's sha256 matches the original
//   6. Clean up GCS + local
//
// This proves the production flow: container start → GCS download →
// /tmp/writer.db ready before SQLite opens it.

import { Storage } from "@google-cloud/storage";
import Database from "better-sqlite3";
import { spawn } from "child_process";
import { createReadStream, createWriteStream } from "fs";
import { mkdir, stat, rm, readFile } from "fs/promises";
import { tmpdir } from "os";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { createHash, randomUUID } from "crypto";
import { createGzip } from "zlib";
import { pipeline } from "stream/promises";

const __dirname = dirname(fileURLToPath(import.meta.url));

const BUCKET = process.env.GCS_BUCKET || "ai-native-writer-db";
const RUN_ID = randomUUID().slice(0, 8);
const TEST_OBJECT = `test-runs/bootstrap-${RUN_ID}/writer.db.gz`;

const log = (msg, fields = {}) =>
  console.log(`[boot-test] ${msg}`, JSON.stringify(fields));
const fail = (msg) => {
  console.error(`[boot-test] FAIL: ${msg}`);
  process.exit(1);
};
const ok = (msg) => console.log(`[boot-test] OK   ${msg}`);

async function sha256OfFile(p) {
  const hash = createHash("sha256");
  await pipeline(createReadStream(p), hash);
  return hash.digest("hex");
}

async function main() {
  log("start", { bucket: BUCKET, runId: RUN_ID, testObject: TEST_OBJECT });

  const tmpDir = join(tmpdir(), `boot-test-${RUN_ID}`);
  await mkdir(tmpDir, { recursive: true });
  const sourcePath = join(tmpDir, "source.db");
  const sourceGzPath = join(tmpDir, "source.db.gz");
  const destPath = join(tmpDir, "downloaded", "writer.db");

  // 1. Create a known db.
  const db = new Database(sourcePath);
  db.pragma("journal_mode = WAL");
  db.pragma("synchronous = FULL");
  db.exec("CREATE TABLE marker (id INTEGER PRIMARY KEY, val TEXT)");
  db.prepare("INSERT INTO marker (val) VALUES (?)").run(`run-${RUN_ID}`);
  db.close();
  const sourceSha = await sha256OfFile(sourcePath);
  ok(`source db built sha=${sourceSha.slice(0, 16)}...`);

  // 2. Gzip + upload to test path on GCS (mimics what backupOnce does).
  await pipeline(
    createReadStream(sourcePath),
    createGzip({ level: 6 }),
    createWriteStream(sourceGzPath)
  );
  const storage = new Storage();
  const bucket = storage.bucket(BUCKET);
  await bucket.file(TEST_OBJECT).save(await readFile(sourceGzPath), {
    contentType: "application/gzip",
    metadata: {
      cacheControl: "no-store",
      metadata: { sha256: sourceSha, source: "boot-test" },
    },
  });
  const [meta] = await bucket.file(TEST_OBJECT).getMetadata();
  ok(`uploaded test object (gen=${meta.generation})`);

  // 3. Spawn the bootstrap script with env vars pointing at our test path.
  const bootArg = join(__dirname, "db-bootstrap.mjs");

  const env = {
    ...process.env,
    DATABASE_PATH: destPath,
    GCS_BUCKET: BUCKET,
    GCS_DB_OBJECT: TEST_OBJECT,
    LEGACY_DB_PATH: "/this/path/should/not/exist",
    BOOTSTRAP_REQUIRED: "true",
  };

  await new Promise((resolve, reject) => {
    const child = spawn("node", [bootArg], { env, stdio: "inherit" });
    child.on("exit", (code) => {
      if (code === 0) resolve(undefined);
      else reject(new Error(`bootstrap exited ${code}`));
    });
    child.on("error", reject);
  });
  ok("bootstrap subprocess exited 0");

  // 4. Verify downloaded file matches source.
  const destStat = await stat(destPath);
  if (destStat.size === 0) fail("downloaded file is empty");
  const destSha = await sha256OfFile(destPath);
  if (destSha !== sourceSha)
    fail(`sha mismatch: source=${sourceSha} downloaded=${destSha}`);
  ok(`downloaded sha256 matches source (${destSha.slice(0, 16)}...)`);

  // 5. Open the downloaded SQLite, verify the marker row is present.
  const verify = new Database(destPath, { readonly: true });
  const row = verify
    .prepare("SELECT val FROM marker WHERE id = 1")
    .get();
  verify.close();
  if (!row || row.val !== `run-${RUN_ID}`)
    fail(`marker row missing or wrong: ${JSON.stringify(row)}`);
  ok(`marker row read back: val="${row.val}"`);

  // 6. Cleanup.
  await bucket.file(TEST_OBJECT).delete().catch(() => {});
  try {
    await rm(tmpDir, { recursive: true, force: true });
  } catch {
    /* windows file-lock cleanup ignored */
  }

  console.log("\nBOOTSTRAP CHECKS PASSED");
  console.log(
    "Container-startup GCS download path is verified end-to-end."
  );
}

main().catch((err) => {
  console.error("[boot-test] uncaught", err);
  process.exit(1);
});
