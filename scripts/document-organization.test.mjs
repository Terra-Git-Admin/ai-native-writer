import assert from "node:assert/strict";
import fs from "node:fs";
import Database from "better-sqlite3";
import {
  cleanFolderName,
  normalizeFolderName,
  parseOrganizationChanges,
  validateFolderName,
} from "../src/lib/document-organization.ts";

assert.equal(cleanFolderName("  CEO   stories "), "CEO stories");
assert.equal(normalizeFolderName("  Medieval  "), "medieval");
assert.equal(validateFolderName("All").ok, false);
assert.equal(validateFolderName("Archived").ok, false);
assert.deepEqual(validateFolderName("Pilot"), {
  ok: true,
  name: "Pilot",
  normalizedName: "pilot",
});
assert.deepEqual(validateFolderName("Medieval"), {
  ok: true,
  name: "Medieval",
  normalizedName: "medieval",
});

const parsed = parseOrganizationChanges({
  folderId: null,
  orientation: "portrait",
  archived: true,
});
assert.equal(parsed.ok, true);
if (parsed.ok) {
  assert.equal(parsed.changes.orientation, "portrait");
  assert.ok(parsed.changes.archivedAt instanceof Date);
}
assert.equal(parseOrganizationChanges({ orientation: "square" }).ok, false);
assert.equal(parseOrganizationChanges({ stage: "pilot" }).ok, false);
assert.equal(parseOrganizationChanges({}).ok, false);

const sqlite = new Database(":memory:");
sqlite.pragma("foreign_keys = ON");
sqlite.exec(`
  CREATE TABLE users (id text PRIMARY KEY NOT NULL);
  CREATE TABLE documents (
    id text PRIMARY KEY NOT NULL,
    owner_id text NOT NULL,
    orientation text DEFAULT 'portrait' NOT NULL,
    updated_at integer NOT NULL,
    FOREIGN KEY (owner_id) REFERENCES users(id)
  );
  INSERT INTO users (id) VALUES ('owner');
  INSERT INTO documents (id, owner_id, updated_at) VALUES ('doc', 'owner', 123);
`);
const migration = fs.readFileSync(
  new URL("../drizzle/0014_document_organization.sql", import.meta.url),
  "utf8"
);
for (const statement of migration.split("--> statement-breakpoint")) {
  if (statement.trim()) sqlite.exec(statement);
}
const migrated = sqlite
  .prepare(
    "SELECT folder_id, orientation, archived_at, updated_at FROM documents WHERE id = 'doc'"
  )
  .get();
assert.deepEqual(migrated, {
  folder_id: null,
  orientation: "portrait",
  archived_at: null,
  updated_at: 123,
});
sqlite
  .prepare(
    "INSERT INTO folders (id, owner_id, name, normalized_name, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)"
  )
  .run("folder", "owner", "CEO", "ceo", 1, 1);
sqlite
  .prepare("UPDATE documents SET folder_id = 'folder' WHERE id = 'doc'")
  .run();
sqlite.prepare("DELETE FROM folders WHERE id = 'folder'").run();
assert.equal(
  sqlite.prepare("SELECT folder_id FROM documents WHERE id = 'doc'").get()
    .folder_id,
  null
);
sqlite.close();

console.log("document organization regression checks passed");
