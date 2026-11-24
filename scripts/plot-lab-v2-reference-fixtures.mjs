import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import Database from "better-sqlite3";

const databasePath = resolve(process.argv[2] ?? "");
const plotDirectory = resolve(process.argv[3] ?? "D:/plotpix/Levi/Plots");
const refreshExisting = process.argv.includes("--refresh");

assert.ok(process.argv[2], "Usage: node scripts/plot-lab-v2-reference-fixtures.mjs <database-path> [plot-directory]");
assert.ok(existsSync(databasePath), `Database not found: ${databasePath}`);

function textNode(text) {
  return { type: "text", text };
}

function heading(text, level) {
  return { type: "heading", attrs: { textAlign: null, level }, content: [textNode(text)] };
}

function paragraph(text) {
  return { type: "paragraph", content: [textNode(text)] };
}

function tiptap(nodes) {
  return JSON.stringify({ type: "doc", content: nodes });
}

function extractEpisodes(source) {
  const matches = [...source.matchAll(/Episode\s+(\d+)\s*\r?\n+([\s\S]*?)(?=\r?\n+Episode\s+\d+|$)/gi)];
  assert.ok(matches.length >= 1, "No episodes found in source plot");
  return matches.map((match) => ({ number: Number(match[1]), plot: match[2].trim().replace(/\r?\n+/g, " ") }));
}

function plotDocument(episodes) {
  return tiptap([
    heading("Microdrama Plots", 1),
    ...episodes.flatMap((episode) => [heading(`Episode ${episode.number}`, 3), paragraph(episode.plot)]),
  ]);
}

function characterDocument(characters) {
  return tiptap([
    heading("Characters", 1),
    ...characters.flatMap((character) => [heading(character.name, 2), paragraph(character.description)]),
  ]);
}

const fixtures = [
  {
    slug: "prince",
    liveDocumentId: "MdBXiTZdWMwE",
    liveTabId: "GMRIuY1qrOdA",
    sourceFile: "Prince till Monetization.txt",
    title: "Plot Lab Reference - Prince",
    summary: "At a royal hunting camp, blacksmith apprentice Karin discovers that the charming arrow collector Yuji is the youngest prince. That night she finds him unconscious and arrow-riddled in the river as armed riders approach.",
    logline: "A courageous blacksmith apprentice must protect a wounded young prince when armed riders close in at the river.",
    characters: [
      { name: "Karin", description: "A skilled, defiant blacksmith apprentice who meets Yuji at the hunting camp and later drags his wounded body from the river." },
      { name: "Yuji", description: "A charming, unpretentious young man first seen collecting arrows, then revealed to be the kingdom's youngest prince." },
      { name: "Mio", description: "Karin's friend, present when Yuji's royal identity is revealed at the hunting camp." },
    ],
  },
  {
    slug: "nurse",
    liveDocumentId: "1rMfkK8uJERu",
    liveTabId: "LYm9OD-50GdC",
    sourceFile: "Nurse till Monetization.txt",
    title: "Plot Lab Reference - Damsel in Distress Nurse",
    summary: "A blood-covered nurse appears at an elite piano concerto before the story flashes back to her saving a critically wounded Yakuza boss in an ambulance. Afterward, his lieutenant offers her an enormous fee to become his private nurse.",
    logline: "After saving a flirtatious Yakuza boss, a gifted nurse saving for her own clinic receives an offer that is not entirely optional.",
    characters: [
      { name: "Yuki", description: "A highly competent nurse saving for her own clinic; practical, warm, financially pressured, and brave under medical danger." },
      { name: "Hiro", description: "A critically wounded Yakuza boss who stays conscious by joking and flirting while Yuki fights to save him." },
      { name: "Ming", description: "Hiro's beautiful, dangerous lieutenant, who tells Yuki that becoming his private nurse is not really a request." },
    ],
  },
  {
    slug: "ring",
    liveDocumentId: "FHz0DuWtKwgm",
    liveTabId: "y5YjmlOgGtW6",
    sourceFile: "Ring till Monetization.txt",
    title: "Plot Lab Reference - Ring",
    summary: "Desperate Hana demands sanctuary at the Saito estate while heir Ren is pressured to find the unknown girl tied to his grandfather's marriage alliance. Hana produces a sealed letter and a sapphire royal ring that shocks him.",
    logline: "A desperate stranger carrying a royal heirloom confronts a skeptical dynasty heir and may be the missing bride his succession depends on.",
    characters: [
      { name: "Hana", description: "A desperate but defiant young woman demanding promised sanctuary, carrying a sealed letter and sapphire heirloom ring." },
      { name: "Ren Saito", description: "A controlled zaibatsu heir who doubts Hana's claim while needing the mysterious alliance bride to secure succession." },
      { name: "Ren's Father", description: "The dynasty head pressuring Ren to find the girl connected to his late grandfather's secret marriage alliance." },
    ],
  },
];

const db = new Database(databasePath);
try {
  const now = Math.floor(Date.now() / 1000);
  const userId = "dev-bypass-user";
  const insertDocument = db.prepare(
    "INSERT INTO documents (id, title, content, active_tab_id, orientation, owner_id, created_at, updated_at, canonical_tabs_version) VALUES (?, ?, ?, ?, 'portrait', ?, ?, ?, 0)"
  );
  const insertTab = db.prepare(
    "INSERT INTO tabs (id, document_id, title, type, content, position, is_protected, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)"
  );
  const updateDocument = db.prepare(
    "UPDATE documents SET title = ?, content = ?, active_tab_id = ?, orientation = 'portrait', updated_at = ? WHERE id = ?"
  );
  const updateTab = db.prepare(
    "UPDATE tabs SET content = ?, updated_at = ? WHERE id = ? AND document_id = ?"
  );

  const seed = db.transaction(() => {
    for (const fixture of fixtures) {
      const documentId = `plot-lab-ref-${fixture.slug}`;
      const sourcePath = resolve(plotDirectory, fixture.sourceFile);
      assert.ok(existsSync(sourcePath), `Source plot not found: ${sourcePath}`);
      const exists = db.prepare("SELECT COUNT(*) AS count FROM documents WHERE id = ?").get(documentId).count > 0;
      assert.ok(!exists || refreshExisting, `Fixture already exists: ${documentId}. Pass --refresh to replace its source tabs.`);

      const episodes = extractEpisodes(readFileSync(sourcePath, "utf8"));
      const research = tiptap([
        heading("Original Research", 1),
        heading("Summary", 2),
        paragraph(fixture.summary),
        heading("Logline", 2),
        paragraph(fixture.logline),
        heading("Fixture Provenance", 2),
        paragraph(`Live document ${fixture.liveDocumentId}, selected tab ${fixture.liveTabId}; plot text loaded from the checked-in pre-monetization reference.`),
      ]);
      const characters = characterDocument(fixture.characters);
      const plots = plotDocument([episodes[0]]);
      const episodeOne = tiptap([
        heading("Predefined Episodes", 1),
        heading("Episode 1", 3),
        paragraph(episodes[0].plot),
      ]);
      const tabIds = {
        research: `${fixture.slug}-research`,
        characters: `${fixture.slug}-characters`,
        plots: `${fixture.slug}-plots`,
        episodes: `${fixture.slug}-episodes`,
      };

      if (exists) {
        updateDocument.run(fixture.title, research, tabIds.plots, now, documentId);
        updateTab.run(research, now, tabIds.research, documentId);
        updateTab.run(characters, now, tabIds.characters, documentId);
        updateTab.run(plots, now, tabIds.plots, documentId);
        updateTab.run(episodeOne, now, tabIds.episodes, documentId);
      } else {
        insertDocument.run(documentId, fixture.title, research, tabIds.plots, userId, now, now);
        insertTab.run(tabIds.research, documentId, "Original Research", "series_overview", research, 0, now, now);
        insertTab.run(tabIds.characters, documentId, "Characters", "characters", characters, 1, now, now);
        insertTab.run(tabIds.plots, documentId, "Microdrama Plots", "microdrama_plots", plots, 4, now, now);
        insertTab.run(tabIds.episodes, documentId, "Predefined Episodes", "predefined_episodes", episodeOne, 5, now, now);
      }
    }
  });

  seed();
  console.log(JSON.stringify({
    databasePath,
    fixtures: fixtures.map((fixture) => ({
      title: fixture.title,
      liveDocumentId: fixture.liveDocumentId,
      localUrl: `http://localhost:3000/doc/plot-lab-ref-${fixture.slug}?tab=${fixture.slug}-plots`,
    })),
  }, null, 2));
} finally {
  db.close();
}
