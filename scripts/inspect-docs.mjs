// Usage: node scripts/inspect-docs.mjs <db-path> <docId1> [docId2 ...]
// Example: node scripts/inspect-docs.mjs ./data/writer-prod.db MIRrdOg9xAUJ wQOnfMMbiV0b
//
// Read-only inspection. Dumps: doc metadata, all versions, all comments,
// merged timeline, and an analysis section flagging suspected silent rollbacks
// (doc.updatedAt newer than the most recent version, non-owner comments after
// the most recent version, etc.).

import Database from "better-sqlite3";
import process from "node:process";

const [, , dbPath, ...docIds] = process.argv;

if (!dbPath || docIds.length === 0) {
  console.error(
    "Usage: node scripts/inspect-docs.mjs <db-path> <docId1> [docId2 ...]"
  );
  process.exit(1);
}

const db = new Database(dbPath, { readonly: true, fileMustExist: true });

function fmtTs(epochSecOrMs) {
  if (epochSecOrMs == null) return "—";
  // drizzle sqlite timestamps are stored as unix epoch seconds (integer column, mode: "timestamp")
  const ms = epochSecOrMs < 1e12 ? epochSecOrMs * 1000 : epochSecOrMs;
  return new Date(ms).toISOString();
}

function bytes(s) {
  if (s == null) return 0;
  return Buffer.byteLength(s, "utf8");
}

function pad(s, n) {
  s = String(s);
  return s.length >= n ? s : s + " ".repeat(n - s.length);
}

function userLookup(userId) {
  if (!userId) return { id: null, name: "(unknown)", email: "" };
  const row = db
    .prepare(`SELECT id, name, email, role FROM users WHERE id = ?`)
    .get(userId);
  return row || { id: userId, name: "(missing)", email: "" };
}

function inspectDoc(docId) {
  console.log("\n" + "=".repeat(80));
  console.log(`DOC ${docId}`);
  console.log("=".repeat(80));

  const doc = db
    .prepare(
      `SELECT id, title, content, owner_id, created_at, updated_at FROM documents WHERE id = ?`
    )
    .get(docId);

  if (!doc) {
    console.log("  NOT FOUND");
    return;
  }

  const owner = userLookup(doc.owner_id);
  const contentBytes = bytes(doc.content);

  console.log(`  title:       ${doc.title}`);
  console.log(`  owner:       ${owner.name} <${owner.email}> (${doc.owner_id})`);
  console.log(`  created_at:  ${fmtTs(doc.created_at)}`);
  console.log(`  updated_at:  ${fmtTs(doc.updated_at)}  <-- CURRENT DB STATE`);
  console.log(`  content:     ${contentBytes} bytes`);

  // Versions (most recent first)
  const versions = db
    .prepare(
      `SELECT id, created_by, length(content) AS content_len, created_at
         FROM document_versions
        WHERE document_id = ?
        ORDER BY created_at DESC`
    )
    .all(docId);

  console.log(`\n  VERSIONS (${versions.length} total)`);
  if (versions.length === 0) {
    console.log("    (none)");
  } else {
    console.log(
      "    " +
        pad("created_at (UTC)", 26) +
        pad("by", 28) +
        pad("content bytes", 16) +
        "version id"
    );
    for (const v of versions) {
      const u = userLookup(v.created_by);
      const who = `${u.name} <${u.email}>`;
      console.log(
        "    " +
          pad(fmtTs(v.created_at), 26) +
          pad(who, 28) +
          pad(v.content_len, 16) +
          v.id
      );
    }
  }

  const latestVersionTs = versions.length > 0 ? versions[0].created_at : null;

  // Comments (most recent first)
  const comments = db
    .prepare(
      `SELECT id, comment_mark_id, author_id, parent_id, resolved, created_at,
              substr(content, 1, 60) AS preview
         FROM comments
        WHERE document_id = ?
        ORDER BY created_at DESC`
    )
    .all(docId);

  console.log(`\n  COMMENTS (${comments.length} total)`);
  if (comments.length === 0) {
    console.log("    (none)");
  } else {
    console.log(
      "    " +
        pad("created_at (UTC)", 26) +
        pad("by", 28) +
        pad("kind", 8) +
        pad("resolved", 10) +
        "preview"
    );
    for (const c of comments) {
      const u = userLookup(c.author_id);
      const who = `${u.name} <${u.email}>`;
      const kind = c.parent_id ? "reply" : "root";
      console.log(
        "    " +
          pad(fmtTs(c.created_at), 26) +
          pad(who, 28) +
          pad(kind, 8) +
          pad(c.resolved ? "yes" : "no", 10) +
          (c.preview || "").replace(/\n/g, " ")
      );
    }
  }

  // Merged timeline (versions + comments, ascending)
  const events = [];
  for (const v of versions) {
    const u = userLookup(v.created_by);
    events.push({
      ts: v.created_at,
      kind: "VERSION",
      who: `${u.name} <${u.email}>`,
      detail: `snapshot ${v.content_len} bytes`,
      isOwner: u.id === doc.owner_id,
    });
  }
  for (const c of comments) {
    const u = userLookup(c.author_id);
    events.push({
      ts: c.created_at,
      kind: c.parent_id ? "COMMENT_REPLY" : "COMMENT",
      who: `${u.name} <${u.email}>`,
      detail: (c.preview || "").replace(/\n/g, " ").slice(0, 50),
      isOwner: u.id === doc.owner_id,
    });
  }
  events.sort((a, b) => a.ts - b.ts);

  console.log(`\n  TIMELINE (oldest first, merged)`);
  for (const e of events) {
    const ownerTag = e.isOwner ? "OWNER " : "OTHER ";
    console.log(
      "    " +
        pad(fmtTs(e.ts), 26) +
        pad(e.kind, 14) +
        ownerTag +
        pad(e.who, 28) +
        e.detail
    );
  }

  // ------ Analysis ------
  console.log(`\n  ANALYSIS`);

  // 1. Gap: updatedAt vs latest version
  if (latestVersionTs != null) {
    const gapSec = doc.updated_at - latestVersionTs;
    const gapHours = (gapSec / 3600).toFixed(1);
    if (gapSec > 300) {
      console.log(
        `    [GAP]  documents.updated_at is ${gapHours}h newer than the most ` +
          `recent version row.`
      );
      console.log(
        `           Expected: ~0 (versions created before each content-changing save).`
      );
      console.log(
        `           Possible causes: commentMarkOnly saves (server does not version those), ` +
          `no-op saves (content identical), or within-5min throttle window.`
      );
    } else {
      console.log(
        `    [OK]   updated_at is within ${Math.round(gapSec)}s of most recent version.`
      );
    }
  } else {
    console.log(`    [INFO] No versions at all — either brand new or versions pruned.`);
  }

  // 2. Non-owner activity after most recent version
  if (latestVersionTs != null) {
    const afterVersion = events.filter(
      (e) => e.ts > latestVersionTs && !e.isOwner
    );
    if (afterVersion.length > 0) {
      console.log(
        `    [FLAG] ${afterVersion.length} non-owner event(s) recorded AFTER the most recent version.`
      );
      console.log(
        `           Each comment add/edit triggers a commentMarkOnly PUT, which currently ` +
          `sends the non-owner's full local editor content to the server and overwrites it ` +
          `WITHOUT writing a version row. If a non-owner's tab had stale content, this is ` +
          `the silent-rollback path.`
      );
      for (const e of afterVersion.slice(0, 8)) {
        console.log(
          `             - ${fmtTs(e.ts)}  ${e.kind}  by ${e.who}`
        );
      }
      if (afterVersion.length > 8) {
        console.log(`             (... ${afterVersion.length - 8} more)`);
      }
    } else {
      console.log(`    [OK]   No non-owner activity after the most recent version.`);
    }
  }

  // 3. Distinct non-owner actors who ever touched comments
  const otherActorIds = new Set();
  for (const c of comments) {
    if (c.author_id !== doc.owner_id) otherActorIds.add(c.author_id);
  }
  if (otherActorIds.size > 0) {
    console.log(
      `    [INFO] ${otherActorIds.size} distinct non-owner actor(s) have commented on this doc:`
    );
    for (const uid of otherActorIds) {
      const u = userLookup(uid);
      console.log(`             - ${u.name} <${u.email}> [role: ${u.role}]`);
    }
  }

  // 4. Version time distribution (detect long silent periods)
  if (versions.length >= 2) {
    const gaps = [];
    for (let i = 0; i < versions.length - 1; i++) {
      const newer = versions[i].created_at;
      const older = versions[i + 1].created_at;
      gaps.push({ from: older, to: newer, dHours: (newer - older) / 3600 });
    }
    const longGaps = gaps.filter((g) => g.dHours > 24);
    if (longGaps.length > 0) {
      console.log(
        `    [INFO] Version-to-version gaps >24h (possible silent periods):`
      );
      for (const g of longGaps) {
        console.log(
          `             ${fmtTs(g.from)} -> ${fmtTs(g.to)}  = ${g.dHours.toFixed(1)}h`
        );
      }
    }
  }
}

console.log(`\nDB: ${dbPath}`);
const allUsers = db.prepare(`SELECT COUNT(*) AS n FROM users`).get();
const allDocs = db.prepare(`SELECT COUNT(*) AS n FROM documents`).get();
const allVers = db.prepare(`SELECT COUNT(*) AS n FROM document_versions`).get();
const allComments = db.prepare(`SELECT COUNT(*) AS n FROM comments`).get();
console.log(
  `Rows: users=${allUsers.n}  documents=${allDocs.n}  document_versions=${allVers.n}  comments=${allComments.n}`
);

for (const id of docIds) {
  inspectDoc(id);
}

console.log("\nDone.\n");
db.close();
