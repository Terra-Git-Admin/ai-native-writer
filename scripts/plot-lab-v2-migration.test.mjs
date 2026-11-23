import assert from "node:assert/strict";
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";

const projectRoot = resolve(import.meta.dirname, "..");
const migrationsFolder = join(projectRoot, "drizzle");
const tempRoot = mkdtempSync(join(tmpdir(), "anw-plot-lab-v2-"));
const baselineFolder = join(tempRoot, "baseline-migrations");
const databasePath = join(tempRoot, "writer.db");

function expectConstraint(fn, label) {
  assert.throws(fn, /constraint|unique/i, label);
}

try {
  mkdirSync(join(baselineFolder, "meta"), { recursive: true });
  const journal = JSON.parse(
    readFileSync(join(migrationsFolder, "meta", "_journal.json"), "utf8")
  );
  const baselineJournal = {
    ...journal,
    entries: journal.entries.filter((entry) => entry.idx <= 14),
  };
  writeFileSync(
    join(baselineFolder, "meta", "_journal.json"),
    `${JSON.stringify(baselineJournal, null, 2)}\n`,
    "utf8"
  );
  for (const entry of baselineJournal.entries) {
    copyFileSync(
      join(migrationsFolder, `${entry.tag}.sql`),
      join(baselineFolder, `${entry.tag}.sql`)
    );
  }

  const sqlite = new Database(databasePath);
  sqlite.pragma("foreign_keys = ON");
  const db = drizzle(sqlite);

  migrate(db, { migrationsFolder: baselineFolder });

  const now = Date.now();
  sqlite
    .prepare(
      "INSERT INTO users (id, email, role, active, plot_lab_access, created_at) VALUES (?, ?, 'admin', 1, 1, ?)"
    )
    .run("user-1", "plot-lab-v2@example.com", now);
  sqlite
    .prepare(
      "INSERT INTO documents (id, title, orientation, owner_id, created_at, updated_at, canonical_tabs_version) VALUES (?, ?, 'portrait', ?, ?, ?, 0)"
    )
    .run("doc-1", "Plot Lab migration fixture", "user-1", now, now);
  sqlite
    .prepare(
      "INSERT INTO ai_jobs (id, document_id, prompt_kind, status, model_id, thinking, created_by, created_at) VALUES (?, ?, ?, 'completed', ?, 0, ?, ?)"
    )
    .run("legacy-job", "doc-1", "next_episode_plot", "legacy-model", "user-1", now);

  migrate(db, { migrationsFolder });

  const aiJobColumns = new Set(
    sqlite.pragma("table_info(ai_jobs)").map((column) => column.name)
  );
  for (const column of [
    "plot_lab_session_id",
    "concurrency_key",
    "session_revision",
    "input_snapshot_json",
    "current_stage",
    "stage_checkpoint_json",
    "stage_attempts_json",
  ]) {
    assert(aiJobColumns.has(column), `missing ai_jobs.${column}`);
  }
  assert.equal(
    sqlite.prepare("SELECT status FROM ai_jobs WHERE id = ?").get("legacy-job").status,
    "completed",
    "the pre-migration Writer job should survive unchanged"
  );

  const sessionInsert = sqlite.prepare(`
    INSERT INTO plot_lab_sessions (
      id, document_id, created_by, status, phase, revision, orientation,
      interview_checkpoint_json, training_pack_version, created_at, updated_at
    ) VALUES (?, 'doc-1', 'user-1', ?, 'intake', ?, 'portrait', '{}', 'v1', ?, ?)
  `);
  sessionInsert.run("session-1", "active", 0, now, now);
  expectConstraint(
    () => sessionInsert.run("session-2", "active", 0, now, now),
    "only one active Plot Lab session may exist per document"
  );
  sessionInsert.run("session-archived", "archived", 0, now, now);
  expectConstraint(
    () => sessionInsert.run("session-negative", "archived", -1, now, now),
    "session revisions must be non-negative"
  );

  const jobInsert = sqlite.prepare(`
    INSERT INTO ai_jobs (
      id, document_id, prompt_kind, status, model_id, thinking, created_by,
      created_at, plot_lab_session_id, concurrency_key
    ) VALUES (?, 'doc-1', 'plot_lab_v2', ?, 'test-model', 0, 'user-1', ?, 'session-1', ?)
  `);
  jobInsert.run("job-1", "running", now, "plot_lab:session-1");
  expectConstraint(
    () => jobInsert.run("job-2", "pending", now, "plot_lab:session-1"),
    "active jobs must have unique concurrency keys"
  );
  jobInsert.run("job-complete", "completed", now, "plot_lab:session-1");

  const outputInsert = sqlite.prepare(`
    INSERT INTO plot_lab_outputs (
      id, session_id, version, status, mutation_kind, batch_json, created_at
    ) VALUES (?, 'session-1', ?, ?, 'initial', '{}', ?)
  `);
  outputInsert.run("output-1", 1, "current", now);
  expectConstraint(
    () => outputInsert.run("output-2", 2, "current", now),
    "only one current output may exist per session"
  );
  outputInsert.run("output-candidate", 2, "candidate", now);

  assert.deepEqual(sqlite.pragma("foreign_key_check"), []);
  assert.equal(sqlite.pragma("integrity_check", { simple: true }), "ok");
  sqlite.close();
  console.log("Plot Lab V2 disposable migration checks passed");
} finally {
  const resolvedTempRoot = resolve(tempRoot);
  const resolvedSystemTemp = resolve(tmpdir());
  assert(
    resolvedTempRoot.startsWith(`${resolvedSystemTemp}${sep}`) &&
      resolvedTempRoot.includes("anw-plot-lab-v2-"),
    "refusing to clean an unexpected path"
  );
  rmSync(resolvedTempRoot, { recursive: true, force: true });
}
