import assert from "node:assert/strict";
import fs from "node:fs";
import Database from "better-sqlite3";
import { ensureAdSectionUids, extractAds, validateTaxonomyName } from "../src/lib/ads-catalog.ts";

const content = JSON.stringify({ type: "doc", content: [
  { type: "paragraph", content: [{ type: "text", text: "Intro outside ads" }] },
  { type: "heading", attrs: { level: 3 }, content: [{ type: "text", text: "Ad: First Hook" }] },
  { type: "paragraph", content: [{ type: "text", text: "A first body" }] },
  { type: "heading", attrs: { level: 3, anwSectionUid: "same" }, content: [{ type: "text", text: "Ad: Duplicate title" }] },
  { type: "paragraph", content: [{ type: "text", text: "Second body" }] },
  { type: "heading", attrs: { level: 3, anwSectionUid: "same" }, content: [{ type: "text", text: "Ad: Duplicate title" }] },
] });
const ensured = ensureAdSectionUids(content);
assert.equal(ensured.changed, true);
assert.equal(ensured.adsSeen, 3);
const ads = extractAds(ensured.contentJson);
assert.equal(ads.length, 3);
assert.equal(new Set(ads.map((ad) => ad.sectionUid)).size, 3);
assert.equal(ads[0].title, "First Hook");
assert.match(ads[0].plainText, /A first body/);
assert.equal(ensureAdSectionUids(ensured.contentJson).changed, false);
assert.equal(extractAds("not-json").length, 0);
assert.equal(validateTaxonomyName("  Character   confession ").ok, true);
assert.equal(validateTaxonomyName("x").ok, false);

const sqlite = new Database(":memory:");
sqlite.pragma("foreign_keys = ON");
sqlite.exec(`
  CREATE TABLE users (id text PRIMARY KEY NOT NULL);
  CREATE TABLE documents (id text PRIMARY KEY NOT NULL);
  INSERT INTO users (id) VALUES ('admin');
  INSERT INTO documents (id) VALUES ('series');
`);
const migration = fs.readFileSync(new URL("../drizzle/0017_admin_ads_library.sql", import.meta.url), "utf8");
for (const statement of migration.split("--> statement-breakpoint")) if (statement.trim()) sqlite.exec(statement);
sqlite.prepare("INSERT INTO ad_families (id,name,normalized_name,description,position,created_at,updated_at) VALUES (?,?,?,?,?,?,?)").run("family", "Trailer", "trailer", "", 0, 1, 1);
sqlite.prepare("INSERT INTO ad_subtypes (id,family_id,name,normalized_name,description,position,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)").run("subtype", "family", "Genre trailer", "genre trailer", "", 0, 1, 1);
sqlite.prepare("INSERT INTO ad_classifications (document_id,section_uid,family_id,subtype_id,updated_by,updated_at) VALUES (?,?,?,?,?,?)").run("series", "ad_1", "family", "subtype", "admin", 1);
assert.equal(sqlite.prepare("SELECT count(*) AS value FROM ad_classifications").get().value, 1);
assert.throws(() => sqlite.prepare("DELETE FROM ad_subtypes WHERE id = 'subtype'").run());
sqlite.close();

console.log("Ads Library parser and migration checks passed");
