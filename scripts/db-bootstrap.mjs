#!/usr/bin/env node
// Container startup bootstrap. Runs BEFORE the Next.js server starts.
// Purpose: get the canonical writer.db onto local /tmp before the app
// opens it. Bypasses gcsfuse entirely.
//
// IMPORTANT: this script uses ZERO external npm dependencies. It relies
// only on Node built-ins (https, fs, zlib). Node's standalone build trace
// for the Next.js app does NOT include arbitrary scripts under /scripts/,
// so importing @google-cloud/storage from here would mean copying the
// whole package + its transitive deps into the runtime image. Easier to
// just talk to GCS over HTTP.
//
// Auth path: Cloud Run's metadata server provides an OAuth token for the
// service account. We fetch a token, then call the GCS JSON API.
// Locally outside Cloud Run: skip the metadata fetch, fall back to the
// app's `gcloud auth application-default login` token via env var
// GOOGLE_OAUTH_TOKEN if you want to test it.
//
// Order of operations:
//   1. If DATABASE_PATH already exists locally → skip (warm restart).
//   2. Try GCS download from gs://<GCS_BUCKET>/<GCS_DB_OBJECT>.
//   3. If GCS object missing AND legacy gcsfuse path has a writer.db →
//      copy it as a one-time migration seed.
//   4. Otherwise leave the path empty so SQLite creates a fresh db.

import https from "https";
import { createWriteStream, createReadStream, existsSync, statSync } from "fs";
import { mkdir, stat, copyFile, unlink } from "fs/promises";
import { dirname } from "path";
import { createGunzip } from "zlib";
import { pipeline } from "stream/promises";

const DATABASE_PATH = process.env.DATABASE_PATH || "/tmp/writer.db";
const GCS_BUCKET = process.env.GCS_BUCKET || "ai-native-writer-db";
const GCS_DB_OBJECT = process.env.GCS_DB_OBJECT || "snapshots/writer.db.gz";
const LEGACY_DB_PATH = process.env.LEGACY_DB_PATH || "/app/data/writer.db";
const BOOTSTRAP_REQUIRED = process.env.BOOTSTRAP_REQUIRED === "true";

function log(event, fields = {}) {
  console.log(
    "[bootstrap] " +
      JSON.stringify({ event, ts: new Date().toISOString(), ...fields })
  );
}

// Fetch an OAuth access token from Cloud Run's metadata server.
// Returns null on failure (e.g. running locally outside GCP).
function getMetadataToken() {
  return new Promise((resolve) => {
    const req = https.request(
      {
        host: "metadata.google.internal",
        path: "/computeMetadata/v1/instance/service-accounts/default/token",
        method: "GET",
        headers: { "Metadata-Flavor": "Google" },
        timeout: 5000,
      },
      (res) => {
        let body = "";
        res.on("data", (chunk) => (body += chunk));
        res.on("end", () => {
          if (res.statusCode !== 200) {
            resolve(null);
            return;
          }
          try {
            const j = JSON.parse(body);
            resolve(j.access_token || null);
          } catch {
            resolve(null);
          }
        });
      }
    );
    req.on("error", () => resolve(null));
    req.on("timeout", () => {
      req.destroy();
      resolve(null);
    });
    // Important: actually emit the request — we forgot a .end() before
    // and node hung silently, which manifested as the bootstrap stalling.
    req.end();
  });
}

// HEAD-equivalent: GET object metadata via JSON API. Returns parsed
// metadata or null when the object is missing or unreachable.
function getObjectMetadata(bucket, object, token) {
  return new Promise((resolve) => {
    const path = `/storage/v1/b/${encodeURIComponent(bucket)}/o/${encodeURIComponent(object)}`;
    const req = https.request(
      {
        host: "storage.googleapis.com",
        path,
        method: "GET",
        headers: { Authorization: `Bearer ${token}` },
        timeout: 30000,
      },
      (res) => {
        let body = "";
        res.on("data", (chunk) => (body += chunk));
        res.on("end", () => {
          if (res.statusCode === 404) {
            resolve({ status: 404 });
            return;
          }
          if (res.statusCode !== 200) {
            resolve({ status: res.statusCode, body });
            return;
          }
          try {
            resolve({ status: 200, meta: JSON.parse(body) });
          } catch {
            resolve({ status: 200, meta: null });
          }
        });
      }
    );
    req.on("error", (err) => resolve({ status: 0, err: err.message }));
    req.on("timeout", () => {
      req.destroy();
      resolve({ status: 0, err: "timeout" });
    });
    req.end();
  });
}

// Stream-download the object body (alt=media) to a local path.
function downloadObject(bucket, object, token, dstPath) {
  return new Promise((resolve, reject) => {
    const path = `/storage/v1/b/${encodeURIComponent(bucket)}/o/${encodeURIComponent(object)}?alt=media`;
    const req = https.request(
      {
        host: "storage.googleapis.com",
        path,
        method: "GET",
        headers: { Authorization: `Bearer ${token}` },
        timeout: 120000,
      },
      (res) => {
        if (res.statusCode !== 200) {
          let body = "";
          res.on("data", (c) => (body += c));
          res.on("end", () =>
            reject(new Error(`download status ${res.statusCode}: ${body.slice(0, 200)}`))
          );
          return;
        }
        const out = createWriteStream(dstPath);
        res.pipe(out);
        out.on("finish", () => resolve(undefined));
        out.on("error", reject);
        res.on("error", reject);
      }
    );
    req.on("error", reject);
    req.on("timeout", () => {
      req.destroy();
      reject(new Error("download timeout"));
    });
    req.end();
  });
}

async function gunzipFile(srcPath, dstPath) {
  await pipeline(
    createReadStream(srcPath),
    createGunzip(),
    createWriteStream(dstPath)
  );
}

async function main() {
  log("start", {
    databasePath: DATABASE_PATH,
    gcsBucket: GCS_BUCKET,
    gcsObject: GCS_DB_OBJECT,
    legacyPath: LEGACY_DB_PATH,
    required: BOOTSTRAP_REQUIRED,
  });

  await mkdir(dirname(DATABASE_PATH), { recursive: true });

  if (existsSync(DATABASE_PATH)) {
    const s = statSync(DATABASE_PATH);
    log("local.exists", { path: DATABASE_PATH, bytes: s.size, mtime: s.mtimeMs });
    log("done", { source: "local-warm" });
    return;
  }

  // Try GCS first.
  const token = await getMetadataToken();
  if (!token) {
    log("metadata.no_token", {
      reason: "metadata server unreachable or returned non-200",
    });
  } else {
    const t0 = Date.now();
    const tmpGz = `${DATABASE_PATH}.boot.gz`;
    const meta = await getObjectMetadata(GCS_BUCKET, GCS_DB_OBJECT, token);
    if (meta.status === 200) {
      try {
        await downloadObject(GCS_BUCKET, GCS_DB_OBJECT, token, tmpGz);
        const gzStat = statSync(tmpGz);
        await gunzipFile(tmpGz, DATABASE_PATH);
        const finalStat = statSync(DATABASE_PATH);
        await unlink(tmpGz).catch(() => {});
        log("gcs.download.ok", {
          bucket: GCS_BUCKET,
          object: GCS_DB_OBJECT,
          generation: String(meta.meta?.generation ?? ""),
          metageneration: String(meta.meta?.metageneration ?? ""),
          reportedSha:
            meta.meta?.metadata?.sha256 ?? null,
          gzBytes: gzStat.size,
          bytes: finalStat.size,
          durationMs: Date.now() - t0,
        });
        log("done", { source: "gcs" });
        return;
      } catch (err) {
        log("gcs.download.fail", {
          err: err instanceof Error ? err.message : String(err),
          durationMs: Date.now() - t0,
        });
      }
    } else if (meta.status === 404) {
      log("gcs.unavailable", { reason: "object-not-found" });
    } else {
      log("gcs.unavailable", {
        reason: "metadata-fetch-failed",
        status: meta.status,
        err: meta.err ?? null,
      });
    }
  }

  // Legacy migration fallback.
  if (existsSync(LEGACY_DB_PATH)) {
    const t0 = Date.now();
    await copyFile(LEGACY_DB_PATH, DATABASE_PATH);
    const s = statSync(DATABASE_PATH);
    log("legacy.copied", {
      from: LEGACY_DB_PATH,
      to: DATABASE_PATH,
      bytes: s.size,
      durationMs: Date.now() - t0,
    });
    log("done", { source: "legacy-migration" });
    return;
  }

  if (BOOTSTRAP_REQUIRED) {
    log("fatal", {
      reason: "no GCS object, no legacy path, BOOTSTRAP_REQUIRED=true",
    });
    process.exit(1);
  }

  log("done", { source: "fresh" });
}

main().catch((err) => {
  log("uncaught", {
    err: err instanceof Error ? err.message : String(err),
    stack: err instanceof Error ? err.stack?.slice(0, 500) : null,
  });
  if (BOOTSTRAP_REQUIRED) process.exit(1);
});
