import assert from "node:assert/strict";
import { existsSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";

const projectRoot = resolve(import.meta.dirname, "..");
const requestedPath = process.argv[2];
if (!requestedPath) throw new Error("Usage: node scripts/ads-library-local-fixture.mjs <new-database-path>");
const databasePath = resolve(requestedPath);
assert.equal(existsSync(databasePath), false, `Refusing to overwrite existing fixture: ${databasePath}`);
mkdirSync(dirname(databasePath), { recursive: true });

const text = (value) => ({ type: "text", text: value });
const heading = (value, uid) => ({ type: "heading", attrs: { level: 3, anwSectionUid: uid }, content: [text(`Ad: ${value}`)] });
const paragraph = (value) => ({ type: "paragraph", content: [text(value)] });
const adsDoc = (ads) => JSON.stringify({ type: "doc", content: ads.flatMap((ad) => [
  heading(ad.title, ad.uid),
  paragraph("A — NEW CLIP"), paragraph(ad.hook),
  paragraph("B — EXISTING FOOTAGE"), paragraph(ad.footage),
  paragraph("C — NEW CLIP"), paragraph(ad.turn),
  paragraph("D — EXISTING FOOTAGE"), paragraph(ad.payoff),
]) });

const sqlite = new Database(databasePath);
try {
  migrate(drizzle(sqlite), { migrationsFolder: resolve(projectRoot, "drizzle") });
  const now = Math.floor(Date.now() / 1000);
  const userId = "dev-bypass-user";
  sqlite.prepare("INSERT INTO users (id,email,name,role,active,plot_lab_access,created_at) VALUES (?,?,?,'admin',1,1,?)")
    .run(userId, "vikas@terra.com", "Dev User", now);

  const series = [
    {
      id: "signed-into-love-demo", title: "Signed Into Love", archivedAt: null,
      ads: [
        { uid: "ad_contract_trap", title: "The Contract Trap", hook: "A signed contract appears before either lead is revealed.", footage: "Use the office confrontation where the contract is challenged.", turn: "The apparent business deal becomes a personal ultimatum.", payoff: "End on the lead signing while hiding her real motive." },
        { uid: "ad_married_revenge", title: "I Married Him for Revenge", hook: "The heroine confesses directly to camera.", footage: "Use her silent wedding-day close-up.", turn: "She admits the groom does not know why she said yes.", payoff: "Cut to him lifting her veil." },
      ],
    },
    {
      id: "revenge-in-heels-demo", title: "Revenge in Heels", archivedAt: null,
      ads: [
        { uid: "ad_everyone_furious", title: "Everyone Is Furious at Episode 4", hook: "Open on escalating viewer comments.", footage: "Use the backstage betrayal from Episode 4.", turn: "A creator reacts to the reveal in disbelief.", payoff: "Freeze on the antagonist smiling at camera." },
        { uid: "ad_three_betrayals", title: "Three Betrayals in 20 Seconds", hook: "Count down three betrayals.", footage: "Use three short performance and backstage reveals.", turn: "Each reveal implicates someone closer to the heroine.", payoff: "The final betrayal comes from her only ally." },
      ],
    },
    {
      id: "secrets-at-sea-demo", title: "Secrets at Sea", archivedAt: null,
      ads: [
        { uid: "ad_killed_husband", title: "Who Killed Her Husband?", hook: "Present three suspects as an interactive choice.", footage: "Use one suspicious glance from each suspect.", turn: "Reveal that all three had a motive.", payoff: "Ask viewers to choose before the cabin door opens." },
        { uid: "ad_ship_trailer", title: "No One Can Leave the Ship", hook: "A 20-second mystery trailer begins with the locked port.", footage: "Use the ballroom, engine room, and storm-deck sequences.", turn: "The murder weapon disappears during the blackout.", payoff: "End on a wet footprint inside a locked cabin." },
      ],
    },
    {
      id: "archived-demo", title: "Archived Test Series", archivedAt: now,
      ads: [{ uid: "ad_archived", title: "Archived Partnership Cut", hook: "A creator introduces the show.", footage: "Use the pilot reveal.", turn: "The recommendation becomes personal.", payoff: "End on Watch now." }],
    },
  ];

  const insertDocument = sqlite.prepare("INSERT INTO documents (id,title,content,active_tab_id,orientation,owner_id,archived_at,created_at,updated_at,canonical_tabs_version) VALUES (?,?,NULL,?,'portrait',?,?,?,?,4)");
  const insertTab = sqlite.prepare("INSERT INTO tabs (id,document_id,title,type,content,position,is_protected,created_at,updated_at) VALUES (?,?, 'Ads','ads',?,6,1,?,?)");
  for (const item of series) {
    const tabId = `${item.id}-ads`;
    insertDocument.run(item.id, item.title, tabId, userId, item.archivedAt, now, now);
    insertTab.run(tabId, item.id, adsDoc(item.ads), now, now);
  }

  const families = [
    ["family-trailer", "Trailer", "15–25 second multi-scene genre trailer"],
    ["family-confession", "Character confession", "Character speaks directly to camera"],
    ["family-reaction", "Reaction", "Creator or viewer reacts to a reveal or betrayal"],
    ["family-listicle", "Recap/listicle", "Fast numbered recap built from show footage"],
  ];
  const subtypes = [
    ["subtype-genre-trailer", "family-trailer", "Genre trailer"],
    ["subtype-direct-confession", "family-confession", "Direct-to-camera secret"],
    ["subtype-reveal-reaction", "family-reaction", "Reveal reaction"],
    ["subtype-countdown", "family-listicle", "Countdown"],
  ];
  const insertFamily = sqlite.prepare("INSERT INTO ad_families (id,name,normalized_name,description,position,created_at,updated_at) VALUES (?,?,?,?,?,?,?)");
  families.forEach((row, index) => insertFamily.run(row[0], row[1], row[1].toLowerCase(), row[2], index, now, now));
  const insertSubtype = sqlite.prepare("INSERT INTO ad_subtypes (id,family_id,name,normalized_name,description,position,created_at,updated_at) VALUES (?,?,?,?,?,0,?,?)");
  subtypes.forEach((row) => insertSubtype.run(row[0], row[1], row[2], row[2].toLowerCase(), "Local example subtype", now, now));
  const insertClassification = sqlite.prepare("INSERT INTO ad_classifications (document_id,section_uid,family_id,subtype_id,updated_by,updated_at) VALUES (?,?,?,?,?,?)");
  [
    ["signed-into-love-demo", "ad_married_revenge", "family-confession", "subtype-direct-confession"],
    ["revenge-in-heels-demo", "ad_everyone_furious", "family-reaction", "subtype-reveal-reaction"],
    ["revenge-in-heels-demo", "ad_three_betrayals", "family-listicle", "subtype-countdown"],
    ["secrets-at-sea-demo", "ad_ship_trailer", "family-trailer", "subtype-genre-trailer"],
  ].forEach((row) => insertClassification.run(row[0], row[1], row[2], row[3], userId, now));

  console.log(JSON.stringify({ databasePath, url: "http://localhost:3010/docs/ads", activeSeries: 3, activeAds: 6, unclassifiedAds: 2, archivedAds: 1 }, null, 2));
} finally {
  sqlite.close();
}
