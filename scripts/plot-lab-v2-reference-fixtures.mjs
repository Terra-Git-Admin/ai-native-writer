import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import Database from "better-sqlite3";

const databasePath = resolve(process.argv[2] ?? "");
const plotDirectory = resolve(process.argv[3] ?? "D:/plotpix/Levi/Plots");

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
    summary: "A blacksmith apprentice saves an apparently amnesiac prince, unaware that his weakness is a performance designed to expose enemies inside the royal court.",
    logline: "After saving a wounded prince, a courageous blacksmith is drawn into his false-amnesia scheme and a palace assassination conspiracy.",
    characters: [
      { name: "Karin", description: "A skilled, defiant blacksmith apprentice whose courage, practical competence, and class insecurity drive her choices." },
      { name: "Yuji", description: "The charming youngest prince, secretly staging amnesia and vulnerability to flush out enemies threatening the crown." },
      { name: "Mio", description: "Karin's loyal friend, whose quick action mobilizes the village and keeps Karin connected to her old life." },
      { name: "King Kai", description: "Yuji's protective elder brother and king, whose safety and succession create the royal pressure system." },
      { name: "Queen Yoko", description: "Kai's politically alert queen, whose fear at Yuji's return suggests knowledge or complicity inside the court." },
      { name: "Goro", description: "Captain of the Royal Guard and Yuji's covert partner in the staged assassination, forced to play both attacker and protector." },
    ],
  },
  {
    slug: "nurse",
    liveDocumentId: "1rMfkK8uJERu",
    liveTabId: "LYm9OD-50GdC",
    sourceFile: "Nurse till Monetization.txt",
    title: "Plot Lab Reference - Damsel in Distress Nurse",
    summary: "A gifted, financially struggling nurse is compelled to care for a wounded Yakuza boss and discovers danger, status, romance, and an unexpected route toward her dream clinic.",
    logline: "After saving a flirtatious Yakuza boss, an ambitious nurse is taken into his dangerous household as enemies close in.",
    characters: [
      { name: "Yuki", description: "A highly competent nurse saving for her own clinic; practical, warm, financially pressured, and brave under medical danger." },
      { name: "Hiro", description: "A charismatic wounded Yakuza boss whose humor and vulnerability create romance while his status attracts lethal opposition." },
      { name: "Ming", description: "Hiro's elegant, dangerous lieutenant who applies pressure, protects Yuki, and develops charged friction with Kamo." },
      { name: "Kamo", description: "Yuki's protective doctor brother, suspicious of the Yakuza and capable of complicating her new alliance." },
      { name: "Toji", description: "A crooked police officer tracking Hiro's survival and driving the incoming institutional threat." },
    ],
  },
  {
    slug: "ring",
    liveDocumentId: "FHz0DuWtKwgm",
    liveTabId: "y5YjmlOgGtW6",
    sourceFile: "Ring till Monetization.txt",
    title: "Plot Lab Reference - Ring",
    summary: "A desperate young woman claims sanctuary from a powerful dynasty using a royal heirloom that may make her the hidden bride required for its succession.",
    logline: "A commoner carrying a royal ring forces a skeptical heir to shelter her, drawing them into romance, succession intrigue, and a masked attack.",
    characters: [
      { name: "Hana", description: "A desperate but proud young woman seeking sanctuary, carrying a royal heirloom and hiding the full truth of her identity." },
      { name: "Ren Saito", description: "A controlled zaibatsu heir caught between succession duty, family manipulation, and his growing promise to protect Hana." },
      { name: "Oda Saito", description: "Ren's politically calculating father, who sees Hana as both a succession solution and a disposable obstacle." },
      { name: "Cho", description: "The older estate maid who observes Hana closely, offers care, and helps reveal Ren's private tenderness." },
      { name: "Noboru", description: "A trusted estate retainer whose incapacitation becomes the first visible proof that the masked threat has breached the house." },
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

  const seed = db.transaction(() => {
    for (const fixture of fixtures) {
      const documentId = `plot-lab-ref-${fixture.slug}`;
      const sourcePath = resolve(plotDirectory, fixture.sourceFile);
      assert.ok(existsSync(sourcePath), `Source plot not found: ${sourcePath}`);
      assert.equal(db.prepare("SELECT COUNT(*) AS count FROM documents WHERE id = ?").get(documentId).count, 0, `Fixture already exists: ${documentId}`);

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
      const plots = plotDocument(episodes);
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

      insertDocument.run(documentId, fixture.title, research, tabIds.plots, userId, now, now);
      insertTab.run(tabIds.research, documentId, "Original Research", "series_overview", research, 0, now, now);
      insertTab.run(tabIds.characters, documentId, "Characters", "characters", characters, 1, now, now);
      insertTab.run(tabIds.plots, documentId, "Microdrama Plots", "microdrama_plots", plots, 4, now, now);
      insertTab.run(tabIds.episodes, documentId, "Predefined Episodes", "predefined_episodes", episodeOne, 5, now, now);
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
