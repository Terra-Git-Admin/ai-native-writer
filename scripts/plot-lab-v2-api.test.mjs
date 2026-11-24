import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { spawn, spawnSync } from "node:child_process";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";

const projectRoot = resolve(import.meta.dirname, "..");
const tempRoot = mkdtempSync(join(tmpdir(), "anw-plot-lab-v2-api-"));
const databasePath = join(tempRoot, "writer.db");
const port = 3217;
const baseUrl = `http://127.0.0.1:${port}`;
let server;
let serverOutput = "";

async function stopServer() {
  if (!server || server.exitCode !== null) return;
  if (process.platform === "win32" && server.pid) {
    spawnSync("taskkill", ["/PID", String(server.pid), "/T", "/F"], { stdio: "ignore" });
  } else {
    server.kill("SIGINT");
  }
  if (server.exitCode === null) {
    await Promise.race([
      new Promise((resolvePromise) => server.once("exit", resolvePromise)),
      new Promise((resolvePromise) => setTimeout(resolvePromise, 5_000)),
    ]);
  }
  await new Promise((resolvePromise) => setTimeout(resolvePromise, 250));
}

function tiptap(...lines) {
  return JSON.stringify({
    type: "doc",
    content: lines.map(([type, text, level]) => ({
      type,
      ...(level ? { attrs: { level } } : {}),
      content: [{ type: "text", text }],
    })),
  });
}

function uuid(index) {
  return `019ab123-4567-789a-8bcd-${String(index).padStart(12, "0")}`;
}

async function waitForServer() {
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    if (server.exitCode !== null) throw new Error(`Next dev exited early:\n${serverOutput}`);
    try {
      const response = await fetch(`${baseUrl}/api/documents/doc-admin-target/plot-lab/session`);
      if (response.status !== 503) return;
    } catch {
      // Server is still starting.
    }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 250));
  }
  throw new Error(`Timed out waiting for Next dev:\n${serverOutput}`);
}

async function postAction(actionId, expectedRevision, action, documentId = "doc-admin-target") {
  return fetch(`${baseUrl}/api/documents/${documentId}/plot-lab/actions`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ actionId, expectedRevision, action }),
  });
}

try {
  const sqlite = new Database(databasePath);
  migrate(drizzle(sqlite), { migrationsFolder: join(projectRoot, "drizzle") });
  const now = Date.now();
  sqlite
    .prepare(
      "INSERT INTO users (id, email, role, active, plot_lab_access, created_at) VALUES (?, ?, ?, 1, 1, ?)"
    )
    .run("dev-bypass-user", "admin@example.com", "admin", now);
  sqlite
    .prepare(
      "INSERT INTO users (id, email, role, active, plot_lab_access, created_at) VALUES (?, ?, ?, 1, 1, ?)"
    )
    .run("owner-user", "owner@example.com", "user", now);
  sqlite
    .prepare(
      "INSERT INTO documents (id, title, orientation, owner_id, created_at, updated_at, canonical_tabs_version) VALUES (?, ?, 'portrait', ?, ?, ?, 0)"
    )
    .run("doc-admin-target", "Admin-access fixture", "owner-user", now, now);
  sqlite
    .prepare(
      "INSERT INTO documents (id, title, orientation, owner_id, created_at, updated_at, canonical_tabs_version) VALUES (?, ?, 'landscape', ?, ?, ?, 0)"
    )
    .run("doc-concurrent", "Concurrent Start fixture", "owner-user", now, now);
  sqlite
    .prepare(
      "INSERT INTO documents (id, title, orientation, owner_id, created_at, updated_at, canonical_tabs_version) VALUES (?, ?, 'portrait', ?, ?, ?, 0)"
    )
    .run("doc-chat", "Completed chat fixture", "owner-user", now, now);
  sqlite.prepare(`
    INSERT INTO plot_lab_sessions (
      id, document_id, created_by, status, phase, revision, orientation, seed,
      source_snapshot_json, references_json, interview_checkpoint_json, retcons_json,
      latest_output_version, prompt_versions_json, model_assignments_json,
      training_pack_version, created_at, updated_at
    ) VALUES (?, ?, ?, 'active', 'complete', 1, 'portrait', ?, ?, '[]', ?, '[]', 1, '{}', '{}', 'unseeded', ?, ?)
  `).run(
    "session-chat",
    "doc-chat",
    "dev-bypass-user",
    "Mira follows the memory trail to the identity reveal at Episode 8.",
    JSON.stringify({ episode1Plot: "Mira delivers a memory to the wrong buyer." }),
    JSON.stringify({ creativeQuestionCount: 2, readyForCreative: true }),
    now,
    now
  );
  sqlite.prepare(`
    INSERT INTO plot_lab_outputs (
      id, session_id, version, status, mutation_kind, batch_json, created_at
    ) VALUES ('session-chat:output:1', 'session-chat', 1, 'current', 'initial_generation', '{}', ?)
  `).run(now);
  const insertTab = sqlite.prepare(
    "INSERT INTO tabs (id, document_id, title, type, content, position, is_protected, created_at, updated_at) VALUES (?, 'doc-admin-target', ?, ?, ?, ?, 1, ?, ?)"
  );
  insertTab.run(
    "tab-research",
    "Original Research",
    "series_overview",
    tiptap(["paragraph", "A city where memories are traded."], ["paragraph", "The lead fears being forgotten."]),
    0,
    now,
    now
  );
  insertTab.run(
    "tab-characters",
    "Characters",
    "characters",
    tiptap(["heading", "Mira", 2], ["paragraph", "A courier who hides a stolen memory."]),
    1,
    now,
    now
  );
  insertTab.run(
    "tab-plots",
    "Microdrama Plots",
    "microdrama_plots",
    tiptap(["heading", "Episode 1", 3], ["paragraph", "Mira delivers a memory to the wrong buyer."]),
    2,
    now,
    now
  );
  sqlite.close();

  server = spawn(process.execPath, [join(projectRoot, "node_modules", "next", "dist", "bin", "next"), "dev", "-p", String(port)], {
    cwd: projectRoot,
    env: {
      ...process.env,
      DATABASE_PATH: databasePath,
      BYPASS_AUTH: "true",
      PLOT_LAB_PRIVATE_RELEASE_ENABLED: "true",
      PLOT_LAB_V2_ENABLED: "true",
      PLOT_LAB_REAL_AI_ENABLED: "false",
      GCS_BUCKET: "",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  server.stdout.on("data", (chunk) => { serverOutput += String(chunk); });
  server.stderr.on("data", (chunk) => { serverOutput += String(chunk); });
  await waitForServer();

  const discussionId = uuid(90);
  const discussion = await postAction(discussionId, 1, {
    kind: "chat",
    text: "Why does Episode 2 follow from Episode 1?",
  }, "doc-chat");
  assert.equal(discussion.status, 200);
  const discussionBody = await discussion.json();
  assert.equal(discussionBody.kind, "discussion");
  assert.equal(discussionBody.session.phase, "complete");
  assert.equal(discussionBody.messages.at(-1).kind, "discussion");

  const discussionReplay = await postAction(discussionId, 1, {
    kind: "chat",
    text: "Why does Episode 2 follow from Episode 1?",
  }, "doc-chat");
  assert.equal(discussionReplay.status, 200);
  assert.equal((await discussionReplay.json()).replayed, true);

  const proposal = await postAction(uuid(91), discussionBody.session.revision, {
    kind: "chat",
    text: "Change Episode 2 so Mira deliberately takes the memory.",
  }, "doc-chat");
  assert.equal(proposal.status, 200);
  const proposalBody = await proposal.json();
  assert.equal(proposalBody.kind, "mutation_proposal");
  assert.equal(proposalBody.messages.at(-1).kind, "mutation_proposal");
  assert.equal(proposalBody.messages.at(-1).payload.applied, false);

  const accepted = await postAction(uuid(92), proposalBody.session.revision, {
    kind: "accept_output",
    outputVersion: 1,
  }, "doc-chat");
  assert.equal(accepted.status, 200);
  const acceptedBody = await accepted.json();
  assert.equal(acceptedBody.kind, "output_accepted");
  assert.equal(acceptedBody.session.latestAcceptedOutputVersion, 1);

  const empty = await fetch(`${baseUrl}/api/documents/doc-admin-target/plot-lab/session`);
  assert.equal(empty.status, 200, "an admin should access a document they do not own");
  assert.equal((await empty.json()).session, null);

  const urlReference = await postAction(uuid(20), 0, {
    kind: "start",
    seed: "This must not start until the URL is safely fetched.",
    references: [{ type: "url", url: "https://example.com/character" }],
  });
  assert.equal(urlReference.status, 422);
  assert.equal((await urlReference.json()).code, "URL_REFERENCES_NOT_AVAILABLE");

  const startId = uuid(1);
  const start = await postAction(startId, 0, {
    kind: "start",
    seed: "Mira must steal back the memory that proves who she is.",
    references: [{ type: "text", text: "Reference: a rival who remembers every betrayal." }],
  });
  assert.equal(start.status, 200);
  const started = await start.json();
  assert.equal(started.session.orientation, "portrait");
  assert.match(started.session.sourceSnapshot.episode1Plot, /wrong buyer/);
  assert.equal(started.session.referenceSnapshots.length, 1);
  assert.equal(started.session.interviewCheckpoint.creativeQuestionCount, 1);
  assert.equal(started.messages.at(-1).kind, "interview_question");

  const questionId = started.messages.at(-1).id;
  const missingFeedbackNote = await fetch(
    `${baseUrl}/api/documents/doc-admin-target/plot-lab/feedback`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ messageId: questionId, rating: "down", note: "" }),
    }
  );
  assert.equal(missingFeedbackNote.status, 400);
  const savedFeedback = await fetch(
    `${baseUrl}/api/documents/doc-admin-target/plot-lab/feedback`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        messageId: questionId,
        rating: "down",
        note: "This question assumes a motivation the writer did not choose.",
      }),
    }
  );
  assert.equal(savedFeedback.status, 200);
  assert.equal((await savedFeedback.json()).feedback.rating, "down");
  const loadedFeedback = await fetch(
    `${baseUrl}/api/documents/doc-admin-target/plot-lab/feedback`
  );
  assert.equal(loadedFeedback.status, 200);
  const loadedFeedbackBody = await loadedFeedback.json();
  assert.equal(loadedFeedbackBody.feedback[0].messageId, questionId);
  assert.match(loadedFeedbackBody.feedback[0].note, /assumes a motivation/);

  const replay = await postAction(startId, 0, {
    kind: "start",
    seed: "Mira must steal back the memory that proves who she is.",
    references: [{ type: "text", text: "Reference: a rival who remembers every betrayal." }],
  });
  assert.equal(replay.status, 200);
  assert.equal((await replay.json()).replayed, true);

  const reused = await postAction(startId, 0, {
    kind: "start",
    seed: "Different seed",
    references: [],
  });
  assert.equal(reused.status, 409);
  assert.equal((await reused.json()).code, "ACTION_ID_REUSED");

  let state = started;
  const generateEarly = await postAction(uuid(21), state.session.revision, {
    kind: "request_generation",
  });
  assert.equal(generateEarly.status, 200);
  state = await generateEarly.json();
  assert.equal(state.kind, "blocking_question");
  assert.equal(state.session.interviewCheckpoint.creativeQuestionCount, 1);
  assert.equal(
    state.messages.filter((message) => message.kind === "interview_question").length,
    1,
    "generate-now must replace the pending question instead of stacking another one"
  );
  const firstAnswerId = uuid(2);
  for (let questionNumber = 1; questionNumber <= 4; questionNumber += 1) {
    const question = state.messages.findLast((message) => message.kind === "interview_question");
    const actionId = questionNumber === 1 ? firstAnswerId : uuid(questionNumber + 1);
    const response = await postAction(actionId, state.session.revision, {
      kind: "answer",
      questionMessageId: question.id,
      text: `Answer ${questionNumber}`,
    });
    assert.equal(response.status, 200);
    state = await response.json();
  }
  assert.equal(state.session.interviewCheckpoint.creativeQuestionCount, 4);
  assert.equal(state.session.interviewCheckpoint.readyForCreative, true);
  assert.equal(
    state.messages.filter((message) => message.kind === "interview_question").length,
    4,
    "the mocked interview must never exceed four questions"
  );

  const firstAnswerMessageId = `${firstAnswerId}:writer`;
  const edited = await postAction(uuid(6), state.session.revision, {
    kind: "edit_answer",
    answerMessageId: firstAnswerMessageId,
    text: "Corrected answer 1",
  });
  assert.equal(edited.status, 200);
  state = await edited.json();
  assert.equal(state.session.interviewCheckpoint.creativeQuestionCount, 2);
  assert.equal(state.session.interviewCheckpoint.readyForCreative, false);
  assert.equal(state.messages.some((message) => message.id === firstAnswerMessageId), false);
  assert.equal(state.messages.some((message) => message.content === "Corrected answer 1"), true);

  const stale = await postAction(uuid(7), state.session.revision - 1, {
    kind: "add_context",
    text: "This should be rejected as stale.",
  });
  assert.equal(stale.status, 409);
  assert.equal((await stale.json()).code, "SESSION_STALE");
  const staleBody = await (async () => {
    const response = await postAction(uuid(70), state.session.revision - 1, {
      kind: "add_context",
      text: "A second stale request should include canonical state.",
    });
    return { status: response.status, body: await response.json() };
  })();
  assert.equal(staleBody.status, 409);
  assert.equal(staleBody.body.canonical.session.revision, state.session.revision);

  const restart = await postAction(uuid(8), state.session.revision, { kind: "restart" });
  assert.equal(restart.status, 200);
  const restarted = await restart.json();
  assert.equal(restarted.session.phase, "intake");
  assert.equal(restarted.session.seed, undefined);

  const restartReplay = await postAction(uuid(8), state.session.revision, { kind: "restart" });
  assert.equal(restartReplay.status, 200);
  const restartReplayBody = await restartReplay.json();
  assert.equal(restartReplayBody.replayed, true);
  assert.equal(restartReplayBody.session.sessionId, restarted.session.sessionId);

  const oldStartReplay = await postAction(startId, 0, {
    kind: "start",
    seed: "Mira must steal back the memory that proves who she is.",
    references: [{ type: "text", text: "Reference: a rival who remembers every betrayal." }],
  });
  assert.equal(oldStartReplay.status, 200);
  const oldStartReplayBody = await oldStartReplay.json();
  assert.equal(oldStartReplayBody.session.status, "archived");
  assert.equal(oldStartReplayBody.canonicalSession.sessionId, restarted.session.sessionId);

  const history = await fetch(`${baseUrl}/api/documents/doc-admin-target/plot-lab/history`);
  assert.equal(history.status, 200);
  const historyBody = await history.json();
  assert.equal(historyBody.sessions.length, 1);
  assert.equal(historyBody.sessions[0].status, "archived");

  const concurrentResponses = await Promise.all([
    postAction(uuid(30), 0, { kind: "start", seed: "First contender", references: [] }, "doc-concurrent"),
    postAction(uuid(31), 0, { kind: "start", seed: "Second contender", references: [] }, "doc-concurrent"),
  ]);
  assert.deepEqual(
    concurrentResponses.map((response) => response.status).sort(),
    [200, 409],
    "concurrent Start requests must yield exactly one winner"
  );
  const concurrentWinner = concurrentResponses.find((response) => response.status === 200);
  const concurrentLoser = concurrentResponses.find((response) => response.status === 409);
  const concurrentWinnerBody = await concurrentWinner.json();
  const concurrentLoserBody = await concurrentLoser.json();
  assert.equal(concurrentWinnerBody.session.orientation, "landscape");
  assert.equal(concurrentLoserBody.code, "SESSION_STALE");
  assert.equal(
    concurrentLoserBody.canonical.session.sessionId,
    concurrentWinnerBody.session.sessionId
  );

  const database = new Database(databasePath, { readonly: true });
  try {
    const proposalCount = database
      .prepare("SELECT COUNT(*) AS count FROM plot_lab_proposals WHERE session_id = 'session-chat' AND status = 'pending'")
      .get().count;
    assert.equal(proposalCount, 1, "a change request must persist one pending non-applying proposal");
    const chatOutputVersion = database
      .prepare("SELECT latest_output_version AS version FROM plot_lab_sessions WHERE id = 'session-chat'")
      .get().version;
    assert.equal(chatOutputVersion, 1, "discussion and proposals must not mutate the current batch");
    const acceptedOutput = database
      .prepare("SELECT accepted_at, accepted_by FROM plot_lab_outputs WHERE session_id = 'session-chat' AND version = 1")
      .get();
    assert(acceptedOutput.accepted_at, "explicit acceptance must timestamp the output");
    assert.equal(acceptedOutput.accepted_by, "dev-bypass-user");
    const supersededCount = database
      .prepare("SELECT COUNT(*) AS count FROM plot_lab_messages WHERE superseded_at IS NOT NULL")
      .get().count;
    assert(supersededCount >= 5, "editing the first answer should supersede its derived descendants");
  } finally {
    database.close();
  }
  console.log("Plot Lab V2 mocked API checks passed");
} finally {
  await stopServer();
  const resolvedTempRoot = resolve(tempRoot);
  const resolvedSystemTemp = resolve(tmpdir());
  assert(
    resolvedTempRoot.startsWith(`${resolvedSystemTemp}${sep}`) &&
      resolvedTempRoot.includes("anw-plot-lab-v2-api-"),
    "refusing to clean an unexpected path"
  );
  rmSync(resolvedTempRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
}
