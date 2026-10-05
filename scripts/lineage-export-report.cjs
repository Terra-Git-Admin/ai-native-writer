#!/usr/bin/env node
/* eslint-disable @typescript-eslint/no-require-imports */
const Database = require("better-sqlite3");

function argValue(name, fallback = null) {
  const idx = process.argv.indexOf(name);
  return idx >= 0 ? process.argv[idx + 1] ?? fallback : fallback;
}

function hasArg(name) {
  return process.argv.includes(name);
}

function sinceToSeconds(value) {
  if (!value || value === "7d") return Math.floor(Date.now() / 1000) - 7 * 24 * 60 * 60;
  const rel = value.match(/^(\d+)([dh])$/i);
  if (rel) {
    const n = Number(rel[1]);
    const unit = rel[2].toLowerCase();
    return Math.floor(Date.now() / 1000) - n * (unit === "d" ? 24 * 60 * 60 : 60 * 60);
  }
  const parsed = Date.parse(value);
  if (!Number.isNaN(parsed)) return Math.floor(parsed / 1000);
  throw new Error(`Invalid --since value: ${value}`);
}

function safeJson(text) {
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function metric(snapshot, key) {
  const parsed = safeJson(snapshot?.metadata_json);
  const value = parsed?.[key];
  return typeof value === "number" ? value : null;
}

function escapeCsv(value) {
  const text = value == null ? "" : String(value);
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

const dbPath = argValue("--db", "data/writer.db");
const since = sinceToSeconds(argValue("--since", "7d"));
const outputJson = hasArg("--json");
const outputCsv = hasArg("--csv");

const db = new Database(dbPath, { readonly: true });

const events = db.prepare(`
  select
    e.id as export_event_id,
    e.export_id,
    e.export_url,
    e.created_at,
    e.document_id,
    d.title as document_title,
    e.lineage_id,
    e.snapshot_id,
    e.previous_export_event_id,
    e.changed_since_previous_export,
    e.episode_number,
    e.episode_title,
    e.section_uid,
    e.spine_id,
    e.spine_revision_id,
    e.generation_run_id,
    e.position_index,
    e.text_hash as final_hash,
    e.text_length as final_length,
    e.match_confidence,
    e.match_reason,
    gr.selected_context_json,
    gr.target_episode_number,
    gr.target_title
  from content_export_events e
  left join documents d on d.id = e.document_id
  left join generation_runs gr on gr.id = e.generation_run_id
  where e.created_at >= ?
  order by e.created_at desc
`).all(since);

const firstByRun = db.prepare(`
  select *
  from content_text_snapshots
  where generation_run_id = ? and snapshot_kind = 'first_generation'
  order by created_at asc
  limit 1
`);

const firstByLineage = db.prepare(`
  select *
  from content_text_snapshots
  where lineage_id = ? and snapshot_kind = 'first_generation'
  order by created_at asc
  limit 1
`);

const rows = events.map((event) => {
  const first =
    (event.generation_run_id ? firstByRun.get(event.generation_run_id) : null) ??
    (event.lineage_id ? firstByLineage.get(event.lineage_id) : null);
  const context = safeJson(event.selected_context_json);
  const selectedPreviousEpisodeCount = Array.isArray(context) ? context.length : 0;
  const firstDialogue = metric(first, "dialogueLines");
  const firstMetadata = safeJson(first?.metadata_json);
  const targetPlot = firstMetadata?.targetPlot && typeof firstMetadata.targetPlot === "object"
    ? firstMetadata.targetPlot
    : null;
  const finalSnapshot = event.snapshot_id
    ? db.prepare("select metadata_json from content_text_snapshots where id = ?").get(event.snapshot_id)
    : null;
  const finalDialogue = metric(finalSnapshot, "dialogueLines");

  return {
    exported_at: new Date(event.created_at * 1000).toISOString(),
    document: event.document_title ?? event.document_id,
    export_id: event.export_id,
    episode: event.episode_number,
    title: event.episode_title,
    position: event.position_index,
    spine_id: event.spine_id,
    spine_revision_id: event.spine_revision_id,
    generation_run_id: event.generation_run_id,
    first_hash: first?.text_hash ?? null,
    final_hash: event.final_hash,
    changed_vs_first: first ? first.text_hash !== event.final_hash : null,
    changed_vs_previous_export: Boolean(event.changed_since_previous_export),
    char_delta: first ? event.final_length - first.text_length : null,
    dialogue_delta:
      firstDialogue != null && finalDialogue != null ? finalDialogue - firstDialogue : null,
    target_plot_hash: targetPlot?.hash ?? null,
    target_plot_length: targetPlot?.rawLength ?? null,
    attached_previous_episodes: selectedPreviousEpisodeCount,
    match_confidence: event.match_confidence,
    match_reason: event.match_reason,
    export_url: event.export_url,
  };
});

if (outputJson) {
  console.log(JSON.stringify(rows, null, 2));
} else if (outputCsv) {
  const headers = Object.keys(rows[0] ?? {
    exported_at: "",
    document: "",
    export_id: "",
    episode: "",
    title: "",
    position: "",
    spine_id: "",
    spine_revision_id: "",
    generation_run_id: "",
    first_hash: "",
    final_hash: "",
    changed_vs_first: "",
    changed_vs_previous_export: "",
    char_delta: "",
    dialogue_delta: "",
    target_plot_hash: "",
    target_plot_length: "",
    attached_previous_episodes: "",
    match_confidence: "",
    match_reason: "",
    export_url: "",
  });
  console.log(headers.join(","));
  for (const row of rows) console.log(headers.map((key) => escapeCsv(row[key])).join(","));
} else {
  console.table(rows);
}
