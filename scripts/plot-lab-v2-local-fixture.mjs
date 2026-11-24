import assert from "node:assert/strict";
import { existsSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";

const projectRoot = resolve(import.meta.dirname, "..");
const requestedPath = process.argv[2];

if (!requestedPath) {
  throw new Error("Usage: node scripts/plot-lab-v2-local-fixture.mjs <new-database-path>");
}

const databasePath = resolve(requestedPath);
assert.equal(
  existsSync(databasePath),
  false,
  "Refusing to overwrite an existing fixture: " + databasePath
);
mkdirSync(dirname(databasePath), { recursive: true });

function tiptap(nodes) {
  return JSON.stringify({ type: "doc", content: nodes });
}

function heading(text, level) {
  return { type: "heading", attrs: { textAlign: null, level }, content: [{ type: "text", text }] };
}

function paragraph(text) {
  return { type: "paragraph", content: [{ type: "text", text }] };
}

const sqlite = new Database(databasePath);
try {
  migrate(drizzle(sqlite), { migrationsFolder: resolve(projectRoot, "drizzle") });
  const now = Date.now();
  const userId = "dev-bypass-user";
  const documentId = "plot-lab-v2-demo";

  sqlite.prepare(
    "INSERT INTO users (id, email, role, active, plot_lab_access, created_at) VALUES (?, ?, 'admin', 1, 1, ?)"
  ).run(userId, "vikas@terra.com", now);

  const originalResearch = tiptap([
    heading("Original Research", 1),
    heading("Summary", 2),
    paragraph("In a city where memories are traded, a courier discovers that her own identity was sold."),
    heading("Logline", 2),
    paragraph("A guarded memory courier must steal back the proof of who she is before her closest ally sells it again."),
  ]);
  const characters = tiptap([
    heading("Characters", 1),
    heading("Mira", 2),
    paragraph("A sharp, guarded courier who can read the emotional residue left on stolen memories."),
    heading("Ilan", 2),
    paragraph("Mira's trusted route planner, whose loyalty hides a debt to the memory exchange."),
  ]);
  const episodeOnePlot = tiptap([
    heading("Microdrama Plots", 1),
    heading("Episode 1", 3),
    paragraph("Mira delivers a sealed memory to the wrong buyer and sees her own childhood inside it. Ilan urges her to run, but quietly alerts the exchange."),
  ]);
  const episodeOneScript = tiptap([
    heading("Predefined Episodes", 1),
    heading("Episode 1", 3),
    paragraph("Mira opens the vial. A little girl with Mira's eyes calls someone else mother. Sirens rise below. Ilan blocks the only stairwell and says he can still save her."),
  ]);

  sqlite.prepare(
    "INSERT INTO documents (id, title, content, active_tab_id, orientation, owner_id, created_at, updated_at, canonical_tabs_version) VALUES (?, ?, ?, ?, 'portrait', ?, ?, ?, 0)"
  ).run(documentId, "Plot Lab V2 — Local Demo", originalResearch, "demo-research", userId, now, now);

  const insertTab = sqlite.prepare(
    "INSERT INTO tabs (id, document_id, title, type, content, position, is_protected, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)"
  );
  insertTab.run("demo-research", documentId, "Original Research", "series_overview", originalResearch, 0, now, now);
  insertTab.run("demo-characters", documentId, "Characters", "characters", characters, 1, now, now);
  insertTab.run("demo-plots", documentId, "Microdrama Plots", "microdrama_plots", episodeOnePlot, 4, now, now);
  insertTab.run("demo-episodes", documentId, "Predefined Episodes", "predefined_episodes", episodeOneScript, 5, now, now);

  console.log(JSON.stringify({ databasePath, documentId, urlPath: "/doc/" + documentId }, null, 2));
} finally {
  sqlite.close();
}
