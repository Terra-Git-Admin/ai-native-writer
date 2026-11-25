import { sqliteTable, text, integer, primaryKey, index, uniqueIndex, check } from "drizzle-orm/sqlite-core";
import { relations, sql } from "drizzle-orm";

export const users = sqliteTable("users", {
  id: text("id").primaryKey(),
  email: text("email").notNull().unique(),
  name: text("name"),
  image: text("image"),
  emailVerified: integer("email_verified", { mode: "timestamp" }),
  role: text("role", { enum: ["admin", "user"] }).notNull().default("user"),
  active: integer("active", { mode: "boolean" }).notNull().default(true),
  plotLabAccess: integer("plot_lab_access", { mode: "boolean" })
    .notNull()
    .default(false),
  createdAt: integer("created_at", { mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date()),
});

export const accounts = sqliteTable(
  "accounts",
  {
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    type: text("type").notNull(),
    provider: text("provider").notNull(),
    providerAccountId: text("provider_account_id").notNull(),
    refresh_token: text("refresh_token"),
    access_token: text("access_token"),
    expires_at: integer("expires_at"),
    token_type: text("token_type"),
    scope: text("scope"),
    id_token: text("id_token"),
    session_state: text("session_state"),
  },
  (table) => [
    primaryKey({ columns: [table.provider, table.providerAccountId] }),
  ]
);

export const sessions = sqliteTable("sessions", {
  sessionToken: text("session_token").primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  expires: integer("expires", { mode: "timestamp" }).notNull(),
});

export const verificationTokens = sqliteTable(
  "verification_tokens",
  {
    identifier: text("identifier").notNull(),
    token: text("token").notNull(),
    expires: integer("expires", { mode: "timestamp" }).notNull(),
  },
  (table) => [primaryKey({ columns: [table.identifier, table.token] })]
);

export const folders = sqliteTable(
  "folders",
  {
    id: text("id").primaryKey(),
    ownerId: text("owner_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    normalizedName: text("normalized_name").notNull(),
    createdAt: integer("created_at", { mode: "timestamp" })
      .notNull()
      .$defaultFn(() => new Date()),
    updatedAt: integer("updated_at", { mode: "timestamp" })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (table) => [
    uniqueIndex("idx_folders_owner_normalized_name").on(
      table.ownerId,
      table.normalizedName
    ),
    index("idx_folders_owner").on(table.ownerId),
  ]
);

export const adFamilies = sqliteTable(
  "ad_families",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    normalizedName: text("normalized_name").notNull(),
    description: text("description").notNull().default(""),
    position: integer("position").notNull().default(0),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull().$defaultFn(() => new Date()),
    updatedAt: integer("updated_at", { mode: "timestamp" }).notNull().$defaultFn(() => new Date()),
  },
  (table) => [
    uniqueIndex("idx_ad_families_normalized_name").on(table.normalizedName),
    index("idx_ad_families_position").on(table.position),
  ]
);

export const adSubtypes = sqliteTable(
  "ad_subtypes",
  {
    id: text("id").primaryKey(),
    familyId: text("family_id").notNull().references(() => adFamilies.id, { onDelete: "restrict" }),
    name: text("name").notNull(),
    normalizedName: text("normalized_name").notNull(),
    description: text("description").notNull().default(""),
    position: integer("position").notNull().default(0),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull().$defaultFn(() => new Date()),
    updatedAt: integer("updated_at", { mode: "timestamp" }).notNull().$defaultFn(() => new Date()),
  },
  (table) => [
    uniqueIndex("idx_ad_subtypes_family_normalized_name").on(table.familyId, table.normalizedName),
    index("idx_ad_subtypes_family_position").on(table.familyId, table.position),
  ]
);

export const documents = sqliteTable("documents", {
  id: text("id").primaryKey(),
  title: text("title").notNull().default("Untitled"),
  // Legacy single-blob content. Kept populated for backwards compat; tab
  // content is the source of truth going forward.
  content: text("content"),
  activeTabId: text("active_tab_id"),
  orientation: text("orientation", { enum: ["portrait", "landscape"] })
    .notNull()
    .default("portrait"),
  ownerId: text("owner_id")
    .notNull()
    .references(() => users.id),
  folderId: text("folder_id").references(() => folders.id, {
    onDelete: "set null",
  }),
  archivedAt: integer("archived_at", { mode: "timestamp" }),
  createdAt: integer("created_at", { mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date()),
  updatedAt: integer("updated_at", { mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date()),
  canonicalTabsVersion: integer("canonical_tabs_version").notNull().default(0),
});

export const pitchWorkspaces = sqliteTable("pitch_workspaces", {
  id: text("id").primaryKey(),
  ownerId: text("owner_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  brief: text("brief").notNull().default(""),
  adaptationStyle: text("adaptation_style", { enum: ["close", "loose"] }),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull().$defaultFn(() => new Date()),
  updatedAt: integer("updated_at", { mode: "timestamp" }).notNull().$defaultFn(() => new Date()),
}, (table) => [uniqueIndex("idx_pitch_workspaces_owner").on(table.ownerId)]);

export const pitchSources = sqliteTable("pitch_sources", {
  id: text("id").primaryKey(),
  workspaceId: text("workspace_id").notNull().references(() => pitchWorkspaces.id, { onDelete: "cascade" }),
  type: text("type", { enum: ["writer_doc", "pasted_text"] }).notNull(),
  sourceDocumentId: text("source_document_id"),
  sourceTabType: text("source_tab_type"),
  title: text("title").notNull(),
  textSnapshot: text("text_snapshot").notNull(),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull().$defaultFn(() => new Date()),
}, (table) => [index("idx_pitch_sources_workspace").on(table.workspaceId)]);

export const pitchIdeas = sqliteTable("pitch_ideas", {
  id: text("id").primaryKey(),
  workspaceId: text("workspace_id").notNull().references(() => pitchWorkspaces.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  ideaText: text("idea_text").notNull(),
  status: text("status", { enum: ["premise", "generated", "shortlisted", "discarded", "promoted"] }).notNull().default("generated"),
  position: integer("position").notNull().default(0),
  promotedDocumentId: text("promoted_document_id"),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull().$defaultFn(() => new Date()),
  updatedAt: integer("updated_at", { mode: "timestamp" }).notNull().$defaultFn(() => new Date()),
}, (table) => [index("idx_pitch_ideas_workspace_position").on(table.workspaceId, table.position)]);

export const tabs = sqliteTable(
  "tabs",
  {
    id: text("id").primaryKey(),
    documentId: text("document_id")
      .notNull()
      .references(() => documents.id, { onDelete: "cascade" }),
    title: text("title").notNull().default("Untitled"),
    // 'custom' | 'series_overview' | 'characters' | 'series_skeleton' |
    // 'microdrama_plots' | 'predefined_episodes' | 'workbook'. Legacy values
    // 'episode_plot', 'reference_episode', 'research' are migrated in place by
    // the heal path on first tab fetch post-PR feat/fixed-tab-structure.
    type: text("type").notNull().default("custom"),
    sequenceNumber: integer("sequence_number"),
    content: text("content"),
    position: integer("position").notNull().default(0),
    // The six canonical tabs (Original Research, Characters, Series Skeleton,
    // Microdrama Plots, Predefined Episodes, Workbook) are seeded for every
    // doc and flagged protected so title/type cannot be edited and the row
    // cannot be deleted.
    isProtected: integer("is_protected", { mode: "boolean" })
      .notNull()
      .default(false),
    createdAt: integer("created_at", { mode: "timestamp" })
      .notNull()
      .$defaultFn(() => new Date()),
    updatedAt: integer("updated_at", { mode: "timestamp" })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (table) => [index("idx_tabs_doc_pos").on(table.documentId, table.position)]
);

export const adClassifications = sqliteTable(
  "ad_classifications",
  {
    documentId: text("document_id").notNull().references(() => documents.id, { onDelete: "cascade" }),
    sectionUid: text("section_uid").notNull(),
    familyId: text("family_id").notNull().references(() => adFamilies.id, { onDelete: "restrict" }),
    subtypeId: text("subtype_id").notNull().references(() => adSubtypes.id, { onDelete: "restrict" }),
    updatedBy: text("updated_by").notNull().references(() => users.id, { onDelete: "restrict" }),
    updatedAt: integer("updated_at", { mode: "timestamp" }).notNull().$defaultFn(() => new Date()),
  },
  (table) => [
    primaryKey({ columns: [table.documentId, table.sectionUid] }),
    index("idx_ad_classifications_family").on(table.familyId),
    index("idx_ad_classifications_subtype").on(table.subtypeId),
  ]
);

export const comments = sqliteTable(
  "comments",
  {
    id: text("id").primaryKey(),
    documentId: text("document_id")
      .notNull()
      .references(() => documents.id, { onDelete: "cascade" }),
    tabId: text("tab_id").references(() => tabs.id, { onDelete: "cascade" }),
    commentMarkId: text("comment_mark_id").notNull(), // matches mark ID in editor
    content: text("content").notNull(),
    quotedText: text("quoted_text"), // the selected text this comment refers to
    authorId: text("author_id")
      .notNull()
      .references(() => users.id),
    parentId: text("parent_id"), // null for root, comment ID for reply
    resolved: integer("resolved", { mode: "boolean" }).notNull().default(false),
    createdAt: integer("created_at", { mode: "timestamp" })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (table) => [
    index("idx_comments_doc_tab").on(table.documentId, table.tabId),
  ]
);

export const documentVersions = sqliteTable(
  "document_versions",
  {
    id: text("id").primaryKey(),
    documentId: text("document_id")
      .notNull()
      .references(() => documents.id, { onDelete: "cascade" }),
    // Nullable for pre-tabs legacy rows (migration 0002 or earlier). New snapshots
    // created post-0003 always set tabId — writers work inside a specific tab.
    tabId: text("tab_id").references(() => tabs.id, { onDelete: "cascade" }),
    content: text("content").notNull(), // Tiptap JSON snapshot
    createdBy: text("created_by")
      .notNull()
      .references(() => users.id),
    createdAt: integer("created_at", { mode: "timestamp" })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (table) => [
    index("idx_docver_doc_tab_created").on(
      table.documentId,
      table.tabId,
      table.createdAt
    ),
  ]
);

export const aiChatHistory = sqliteTable("ai_chat_history", {
  id: text("id").primaryKey(),
  documentId: text("document_id")
    .notNull()
    .references(() => documents.id, { onDelete: "cascade" }),
  entryType: text("entry_type").notNull(), // "mode-change" | "message"
  role: text("role"), // "user" | "assistant" (null for mode-change)
  content: text("content"), // message text (null for mode-change)
  mode: text("mode").notNull(), // "edit" | "draft" | "feedback"
  createdAt: integer("created_at", { mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date()),
});

export const prompts = sqliteTable("prompts", {
  id: text("id").primaryKey(), // "edit", "draft", "feedback", "format", "style_guide"
  label: text("label").notNull(),
  content: text("content").notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date()),
});

export const aiSettings = sqliteTable("ai_settings", {
  id: text("id").primaryKey(), // "anthropic", "google", or "openai"
  apiKey: text("api_key").notNull(), // encrypted
  updatedAt: integer("updated_at", { mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date()),
});

// Server-authoritative Plot Lab V2 workflow aggregate. Stage 1 does not read
// these tables, so the V2 migration remains additive and can ship disabled.
export const plotLabSessions = sqliteTable(
  "plot_lab_sessions",
  {
    id: text("id").primaryKey(),
    documentId: text("document_id")
      .notNull()
      .references(() => documents.id, { onDelete: "cascade" }),
    createdBy: text("created_by")
      .notNull()
      .references(() => users.id),
    status: text("status", { enum: ["active", "archived"] })
      .notNull()
      .default("active"),
    phase: text("phase", {
      enum: [
        "intake",
        "interview",
        "purpose_review",
        "queued",
        "orchestrating",
        "creative",
        "reviewing",
        "connecting",
        "complete",
        "recoverable_error",
      ],
    })
      .notNull()
      .default("intake"),
    revision: integer("revision").notNull().default(0),
    orientation: text("orientation", { enum: ["portrait", "landscape"] }).notNull(),
    seed: text("seed"),
    sourceSnapshotJson: text("source_snapshot_json"),
    sourceHashesJson: text("source_hashes_json"),
    referencesJson: text("references_json").notNull().default("[]"),
    interviewCheckpointJson: text("interview_checkpoint_json").notNull(),
    retconsJson: text("retcons_json").notNull().default("[]"),
    latestOutputVersion: integer("latest_output_version"),
    latestAcceptedOutputVersion: integer("latest_accepted_output_version"),
    activeJobId: text("active_job_id"),
    pendingSyncActionId: text("pending_sync_action_id"),
    failedStage: text("failed_stage", {
      enum: ["purpose_planning", "plot_writing", "source_truth", "endpoint_exploration", "route_exploration", "specialist_planning", "creative_authoring", "holistic_qa", "targeted_repair", "connecting", "creative", "unit_creative", "continuity"],
    }),
    promptVersionsJson: text("prompt_versions_json").notNull().default("{}"),
    modelAssignmentsJson: text("model_assignments_json").notNull().default("{}"),
    trainingPackVersion: text("training_pack_version").notNull(),
    createdAt: integer("created_at", { mode: "timestamp" })
      .notNull()
      .$defaultFn(() => new Date()),
    updatedAt: integer("updated_at", { mode: "timestamp" })
      .notNull()
      .$defaultFn(() => new Date()),
    archivedAt: integer("archived_at", { mode: "timestamp" }),
  },
  (table) => [
    check("plot_lab_sessions_revision_nonnegative", sql`${table.revision} >= 0`),
    uniqueIndex("idx_plot_lab_sessions_active_document")
      .on(table.documentId)
      .where(sql`${table.status} = 'active'`),
    index("idx_plot_lab_sessions_document_status_updated").on(
      table.documentId,
      table.status,
      table.updatedAt
    ),
  ]
);

// Durable AI generation jobs. Each job is one button press of an action like
// "Create Plot Chunks". Lives server-side so the work survives tab switches
// and page reloads. On boot, orphan running rows are healed to status='failed'
// with reason='instance_restart' (instrumentation.ts).
//
// Designed for low write count: 1 INSERT (create) + 1 UPDATE (complete or
// fail or cancel) per job. Token streaming is in-memory only; the DB never
// sees per-token writes.
export const aiJobs = sqliteTable(
  "ai_jobs",
  {
    id: text("id").primaryKey(),
    documentId: text("document_id")
      .notNull()
      .references(() => documents.id, { onDelete: "cascade" }),
    // Originating tab. Used for UI scoping ("which tab's chat surfaces this
    // result") and debug audit. Nullable for non-tab-bound future jobs.
    tabId: text("tab_id").references(() => tabs.id, { onDelete: "cascade" }),
    // 'plot_chunks' | 'next_episode_plot' | 'next_reference_episode'. Brainstorm
    // Dialogues lands as a 4th value in v2.
    promptKind: text("prompt_kind").notNull(),
    // 'pending' | 'running' | 'completed' | 'failed' | 'cancelled'.
    status: text("status").notNull().default("pending"),
    modelId: text("model_id").notNull(),
    thinking: integer("thinking", { mode: "boolean" }).notNull().default(false),
    // JSON snapshot of the inputs that fed the LLM call (audit + debug).
    contextSnapshot: text("context_snapshot"),
    // JSON-encoded result. { content: string } for v1.
    resultJson: text("result_json"),
    failureReason: text("failure_reason"),
    // Optional free-text guidance from the writer (passed via chat on skeleton tab).
    userGuidance: text("user_guidance"),
    // User who initiated the job. References users.id; cascade-delete with user.
    createdBy: text("created_by")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    createdAt: integer("created_at", { mode: "timestamp" })
      .notNull()
      .$defaultFn(() => new Date()),
    startedAt: integer("started_at", { mode: "timestamp" }),
    completedAt: integer("completed_at", { mode: "timestamp" }),
    // Plot Lab V2 fields are nullable so all existing Writer jobs remain valid.
    plotLabSessionId: text("plot_lab_session_id").references(
      () => plotLabSessions.id,
      { onDelete: "set null" }
    ),
    concurrencyKey: text("concurrency_key"),
    sessionRevision: integer("session_revision"),
    inputSnapshotJson: text("input_snapshot_json"),
    currentStage: text("current_stage"),
    stageCheckpointJson: text("stage_checkpoint_json"),
    stageAttemptsJson: text("stage_attempts_json"),
  },
  (table) => [
    uniqueIndex("idx_ai_jobs_active_concurrency_key")
      .on(table.concurrencyKey)
      .where(sql`${table.status} IN ('pending', 'running')`),
    index("idx_ai_jobs_plot_lab_session").on(table.plotLabSessionId),
  ]
);

export const aiJobsRelations = relations(aiJobs, ({ one }) => ({
  document: one(documents, {
    fields: [aiJobs.documentId],
    references: [documents.id],
  }),
  tab: one(tabs, {
    fields: [aiJobs.tabId],
    references: [tabs.id],
  }),
  creator: one(users, {
    fields: [aiJobs.createdBy],
    references: [users.id],
  }),
  plotLabSession: one(plotLabSessions, {
    fields: [aiJobs.plotLabSessionId],
    references: [plotLabSessions.id],
  }),
}));

export const plotLabActions = sqliteTable(
  "plot_lab_actions",
  {
    id: text("id").primaryKey(),
    actionId: text("action_id").notNull().unique(),
    documentId: text("document_id")
      .notNull()
      .references(() => documents.id, { onDelete: "cascade" }),
    sessionId: text("session_id")
      .notNull()
      .references(() => plotLabSessions.id, { onDelete: "cascade" }),
    createdBy: text("created_by")
      .notNull()
      .references(() => users.id),
    requestHash: text("request_hash").notNull(),
    actionKind: text("action_kind").notNull(),
    baseRevision: integer("base_revision").notNull(),
    status: text("status", {
      enum: [
        "reserved",
        "awaiting_source_confirmation",
        "queued",
        "completed",
        "failed",
      ],
    }).notNull(),
    requestJson: text("request_json").notNull(),
    responseJson: text("response_json"),
    jobId: text("job_id").references(() => aiJobs.id, { onDelete: "set null" }),
    createdAt: integer("created_at", { mode: "timestamp" })
      .notNull()
      .$defaultFn(() => new Date()),
    completedAt: integer("completed_at", { mode: "timestamp" }),
  },
  (table) => [
    index("idx_plot_lab_actions_session_created").on(table.sessionId, table.createdAt),
    index("idx_plot_lab_actions_document_created").on(table.documentId, table.createdAt),
  ]
);

export const plotLabMessages = sqliteTable(
  "plot_lab_messages",
  {
    id: text("id").primaryKey(),
    sessionId: text("session_id")
      .notNull()
      .references(() => plotLabSessions.id, { onDelete: "cascade" }),
    sequence: integer("sequence").notNull(),
    role: text("role", { enum: ["writer", "levi", "system"] }).notNull(),
    kind: text("kind").notNull(),
    content: text("content").notNull(),
    payloadJson: text("payload_json"),
    actionId: text("action_id"),
    parentMessageId: text("parent_message_id"),
    dependencyIdsJson: text("dependency_ids_json").notNull().default("[]"),
    replayScope: text("replay_scope", { enum: ["derived", "session"] }).notNull(),
    supersededAt: integer("superseded_at", { mode: "timestamp" }),
    createdAt: integer("created_at", { mode: "timestamp" })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (table) => [
    uniqueIndex("idx_plot_lab_messages_session_sequence").on(
      table.sessionId,
      table.sequence
    ),
    index("idx_plot_lab_messages_parent").on(table.parentMessageId),
    index("idx_plot_lab_messages_action").on(table.actionId),
  ]
);

export const plotLabProposals = sqliteTable(
  "plot_lab_proposals",
  {
    id: text("id").primaryKey(),
    sessionId: text("session_id")
      .notNull()
      .references(() => plotLabSessions.id, { onDelete: "cascade" }),
    sourceMessageId: text("source_message_id")
      .notNull()
      .references(() => plotLabMessages.id, { onDelete: "cascade" }),
    baseOutputVersion: integer("base_output_version").notNull(),
    instruction: text("instruction").notNull(),
    targetUnitsJson: text("target_units_json").notNull(),
    downstreamUnitsJson: text("downstream_units_json").notNull().default("[]"),
    explanation: text("explanation").notNull(),
    repairScope: text("repair_scope", { enum: ["connector", "unit", "route", "destination"] })
      .notNull()
      .default("route"),
    status: text("status", {
      enum: ["pending", "confirmed", "rejected", "stale"],
    })
      .notNull()
      .default("pending"),
    confirmedChoice: text("confirmed_choice", { enum: ["update", "keep"] }),
    createdAt: integer("created_at", { mode: "timestamp" })
      .notNull()
      .$defaultFn(() => new Date()),
    resolvedAt: integer("resolved_at", { mode: "timestamp" }),
  },
  (table) => [
    index("idx_plot_lab_proposals_session_status").on(table.sessionId, table.status),
    index("idx_plot_lab_proposals_source_message").on(table.sourceMessageId),
  ]
);

export const plotLabOutputs = sqliteTable(
  "plot_lab_outputs",
  {
    id: text("id").primaryKey(),
    sessionId: text("session_id")
      .notNull()
      .references(() => plotLabSessions.id, { onDelete: "cascade" }),
    version: integer("version").notNull(),
    parentVersion: integer("parent_version"),
    jobId: text("job_id").references(() => aiJobs.id, { onDelete: "set null" }),
    proposalId: text("proposal_id").references(() => plotLabProposals.id, {
      onDelete: "set null",
    }),
    status: text("status", {
      enum: ["candidate", "current", "superseded", "discarded"],
    }).notNull(),
    mutationKind: text("mutation_kind").notNull(),
    batchJson: text("batch_json").notNull(),
    degradedText: text("degraded_text"),
    createdAt: integer("created_at", { mode: "timestamp" })
      .notNull()
      .$defaultFn(() => new Date()),
    supersededAt: integer("superseded_at", { mode: "timestamp" }),
    acceptedAt: integer("accepted_at", { mode: "timestamp" }),
    acceptedBy: text("accepted_by").references(() => users.id, { onDelete: "set null" }),
  },
  (table) => [
    uniqueIndex("idx_plot_lab_outputs_session_version").on(table.sessionId, table.version),
    uniqueIndex("idx_plot_lab_outputs_current_session")
      .on(table.sessionId)
      .where(sql`${table.status} = 'current'`),
    index("idx_plot_lab_outputs_job").on(table.jobId),
  ]
);

export const plotLabFeedback = sqliteTable(
  "plot_lab_feedback",
  {
    id: text("id").primaryKey(),
    sessionId: text("session_id")
      .notNull()
      .references(() => plotLabSessions.id, { onDelete: "cascade" }),
    messageId: text("message_id").references(() => plotLabMessages.id, {
      onDelete: "set null",
    }),
    outputVersion: integer("output_version").notNull(),
    unitNumber: integer("unit_number"),
    rating: text("rating").notNull(),
    note: text("note"),
    promptVersionsJson: text("prompt_versions_json").notNull(),
    modelAssignmentsJson: text("model_assignments_json").notNull(),
    trainingPackVersion: text("training_pack_version").notNull(),
    createdBy: text("created_by")
      .notNull()
      .references(() => users.id),
    createdAt: integer("created_at", { mode: "timestamp" })
      .notNull()
      .$defaultFn(() => new Date()),
    updatedAt: integer("updated_at", { mode: "timestamp" })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (table) => [
    index("idx_plot_lab_feedback_session_output").on(
      table.sessionId,
      table.outputVersion
    ),
    index("idx_plot_lab_feedback_message").on(table.messageId),
  ]
);

export const handoffExports = sqliteTable(
  "handoff_exports",
  {
    id: text("id").primaryKey(),
    documentId: text("document_id")
      .notNull()
      .references(() => documents.id, { onDelete: "cascade" }),
    createdBy: text("created_by")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    exportJson: text("export_json").notNull(),
    createdAt: integer("created_at", { mode: "timestamp" })
      .notNull()
      .$defaultFn(() => new Date()),
    expiresAt: integer("expires_at", { mode: "timestamp" }).notNull(),
  },
  (table) => [
    index("idx_handoff_exports_doc").on(table.documentId),
    index("idx_handoff_exports_expires").on(table.expiresAt),
  ]
);

export const handoffExportsRelations = relations(handoffExports, ({ one }) => ({
  document: one(documents, {
    fields: [handoffExports.documentId],
    references: [documents.id],
  }),
  creator: one(users, {
    fields: [handoffExports.createdBy],
    references: [users.id],
  }),
}));

export const contentLineages = sqliteTable(
  "content_lineages",
  {
    id: text("id").primaryKey(),
    documentId: text("document_id")
      .notNull()
      .references(() => documents.id, { onDelete: "cascade" }),
    tabId: text("tab_id").references(() => tabs.id, { onDelete: "set null" }),
    artifactType: text("artifact_type", {
      enum: ["predefined_episode", "plot_lab_plot"],
    }).notNull(),
    currentNumber: integer("current_number"),
    currentTitle: text("current_title"),
    sectionUid: text("section_uid"),
    spineId: text("spine_id"),
    generationRunId: text("generation_run_id"),
    status: text("status", {
      enum: ["active", "deleted_from_tab", "exported"],
    })
      .notNull()
      .default("active"),
    createdAt: integer("created_at", { mode: "timestamp" })
      .notNull()
      .$defaultFn(() => new Date()),
    updatedAt: integer("updated_at", { mode: "timestamp" })
      .notNull()
      .$defaultFn(() => new Date()),
    lastSeenAt: integer("last_seen_at", { mode: "timestamp" }),
  },
  (table) => [
    index("idx_content_lineages_doc_type_number").on(
      table.documentId,
      table.artifactType,
      table.currentNumber
    ),
    index("idx_content_lineages_section").on(table.documentId, table.sectionUid),
    index("idx_content_lineages_spine").on(table.documentId, table.spineId),
    index("idx_content_lineages_doc_status").on(table.documentId, table.status),
  ]
);

export const storySpines = sqliteTable(
  "story_spines",
  {
    id: text("id").primaryKey(),
    documentId: text("document_id")
      .notNull()
      .references(() => documents.id, { onDelete: "cascade" }),
    sourceTabId: text("source_tab_id").references(() => tabs.id, { onDelete: "set null" }),
    sourceSectionUid: text("source_section_uid"),
    initialEpisodeNumber: integer("initial_episode_number"),
    initialTitle: text("initial_title"),
    currentEpisodeNumber: integer("current_episode_number"),
    currentTitle: text("current_title"),
    currentPositionIndex: integer("current_position_index"),
    status: text("status", {
      enum: ["active", "replaced", "abandoned", "deleted"],
    })
      .notNull()
      .default("active"),
    replacesSpineId: text("replaces_spine_id"),
    createdAt: integer("created_at", { mode: "timestamp" })
      .notNull()
      .$defaultFn(() => new Date()),
    updatedAt: integer("updated_at", { mode: "timestamp" })
      .notNull()
      .$defaultFn(() => new Date()),
    lastSeenAt: integer("last_seen_at", { mode: "timestamp" }),
  },
  (table) => [
    index("idx_story_spines_doc_section").on(table.documentId, table.sourceSectionUid),
    index("idx_story_spines_doc_status").on(table.documentId, table.status),
  ]
);

export const storySpineRevisions = sqliteTable(
  "story_spine_revisions",
  {
    id: text("id").primaryKey(),
    spineId: text("spine_id")
      .notNull()
      .references(() => storySpines.id, { onDelete: "cascade" }),
    documentId: text("document_id")
      .notNull()
      .references(() => documents.id, { onDelete: "cascade" }),
    tabId: text("tab_id").references(() => tabs.id, { onDelete: "set null" }),
    sectionUid: text("section_uid"),
    episodeNumber: integer("episode_number"),
    episodeTitle: text("episode_title"),
    positionIndex: integer("position_index"),
    textRaw: text("text_raw").notNull(),
    textComparable: text("text_comparable").notNull(),
    textHash: text("text_hash").notNull(),
    textLength: integer("text_length").notNull(),
    snapshotKind: text("snapshot_kind", {
      enum: ["plot_saved", "plot_selected", "plot_replaced", "tombstone"],
    })
      .notNull()
      .default("plot_saved"),
    metadataJson: text("metadata_json"),
    createdBy: text("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: integer("created_at", { mode: "timestamp" })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (table) => [
    index("idx_story_spine_revisions_spine_created").on(table.spineId, table.createdAt),
    index("idx_story_spine_revisions_doc_hash").on(table.documentId, table.textHash),
  ]
);

export const generationRuns = sqliteTable(
  "generation_runs",
  {
    id: text("id").primaryKey(),
    documentId: text("document_id")
      .notNull()
      .references(() => documents.id, { onDelete: "cascade" }),
    spineId: text("spine_id").references(() => storySpines.id, { onDelete: "set null" }),
    spineRevisionId: text("spine_revision_id").references(() => storySpineRevisions.id, { onDelete: "set null" }),
    sourceSurface: text("source_surface", { enum: ["predefined_lab", "plot_lab"] })
      .notNull()
      .default("predefined_lab"),
    targetEpisodeNumber: integer("target_episode_number"),
    targetTitle: text("target_title"),
    writerInstructionHash: text("writer_instruction_hash"),
    writerInstructionLength: integer("writer_instruction_length"),
    selectedContextJson: text("selected_context_json"),
    modelId: text("model_id"),
    promptMode: text("prompt_mode"),
    createdBy: text("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: integer("created_at", { mode: "timestamp" })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (table) => [
    index("idx_generation_runs_doc_created").on(table.documentId, table.createdAt),
    index("idx_generation_runs_spine").on(table.spineId),
  ]
);

export const contentTextSnapshots = sqliteTable(
  "content_text_snapshots",
  {
    id: text("id").primaryKey(),
    lineageId: text("lineage_id")
      .notNull()
      .references(() => contentLineages.id, { onDelete: "cascade" }),
    documentId: text("document_id")
      .notNull()
      .references(() => documents.id, { onDelete: "cascade" }),
    tabId: text("tab_id").references(() => tabs.id, { onDelete: "set null" }),
    artifactType: text("artifact_type", {
      enum: ["predefined_episode", "plot_lab_plot"],
    }).notNull(),
    sourceSurface: text("source_surface", {
      enum: ["predefined_lab", "predefined_tab", "handoff_export", "plot_lab"],
    }).notNull(),
    snapshotKind: text("snapshot_kind", {
      enum: ["first_generation", "final_saved", "final_export", "interim_generation", "tombstone"],
    }).notNull(),
    snapshotStatus: text("snapshot_status", {
      enum: ["active", "trashed_by_user", "abandoned_by_reset"],
    })
      .notNull()
      .default("active"),
    sourceId: text("source_id"),
    labRunId: text("lab_run_id"),
    labTurnId: text("lab_turn_id"),
    parentSnapshotId: text("parent_snapshot_id"),
    turnIndex: integer("turn_index"),
    episodeNumber: integer("episode_number"),
    episodeTitle: text("episode_title"),
    sectionUid: text("section_uid"),
    spineId: text("spine_id").references(() => storySpines.id, { onDelete: "set null" }),
    spineRevisionId: text("spine_revision_id").references(() => storySpineRevisions.id, { onDelete: "set null" }),
    generationRunId: text("generation_run_id").references(() => generationRuns.id, { onDelete: "set null" }),
    positionIndex: integer("position_index"),
    matchConfidence: text("match_confidence", { enum: ["high", "medium", "low", "none"] })
      .notNull()
      .default("none"),
    matchReason: text("match_reason"),
    textRaw: text("text_raw").notNull(),
    textComparable: text("text_comparable").notNull(),
    textHash: text("text_hash").notNull(),
    textLength: integer("text_length").notNull(),
    metadataJson: text("metadata_json"),
    createdBy: text("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: integer("created_at", { mode: "timestamp" })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (table) => [
    index("idx_content_snapshots_lineage_created").on(
      table.lineageId,
      table.createdAt
    ),
    index("idx_content_snapshots_doc_kind").on(
      table.documentId,
      table.snapshotKind
    ),
    index("idx_content_snapshots_source").on(
      table.sourceSurface,
      table.sourceId
    ),
    index("idx_content_snapshots_spine").on(table.spineId),
    index("idx_content_snapshots_generation_run").on(table.generationRunId),
  ]
);

export const contentExportEvents = sqliteTable(
  "content_export_events",
  {
    id: text("id").primaryKey(),
    documentId: text("document_id")
      .notNull()
      .references(() => documents.id, { onDelete: "cascade" }),
    exportId: text("export_id")
      .notNull()
      .references(() => handoffExports.id, { onDelete: "cascade" }),
    exportUrl: text("export_url"),
    lineageId: text("lineage_id").references(() => contentLineages.id, { onDelete: "set null" }),
    snapshotId: text("snapshot_id").references(() => contentTextSnapshots.id, { onDelete: "set null" }),
    previousExportEventId: text("previous_export_event_id"),
    changedSincePreviousExport: integer("changed_since_previous_export", { mode: "boolean" })
      .notNull()
      .default(true),
    episodeNumber: integer("episode_number"),
    episodeTitle: text("episode_title"),
    sectionUid: text("section_uid"),
    spineId: text("spine_id").references(() => storySpines.id, { onDelete: "set null" }),
    spineRevisionId: text("spine_revision_id").references(() => storySpineRevisions.id, { onDelete: "set null" }),
    generationRunId: text("generation_run_id").references(() => generationRuns.id, { onDelete: "set null" }),
    positionIndex: integer("position_index"),
    textHash: text("text_hash").notNull(),
    textLength: integer("text_length").notNull(),
    matchConfidence: text("match_confidence", { enum: ["high", "medium", "low", "none"] })
      .notNull()
      .default("none"),
    matchReason: text("match_reason"),
    createdBy: text("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: integer("created_at", { mode: "timestamp" })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (table) => [
    index("idx_content_export_events_doc_created").on(table.documentId, table.createdAt),
    index("idx_content_export_events_export").on(table.exportId),
    index("idx_content_export_events_lineage").on(table.lineageId),
  ]
);

// Relations
export const usersRelations = relations(users, ({ many }) => ({
  accounts: many(accounts),
  sessions: many(sessions),
  documents: many(documents),
  folders: many(folders),
  comments: many(comments),
}));

export const foldersRelations = relations(folders, ({ one, many }) => ({
  owner: one(users, { fields: [folders.ownerId], references: [users.id] }),
  documents: many(documents),
}));

export const accountsRelations = relations(accounts, ({ one }) => ({
  user: one(users, { fields: [accounts.userId], references: [users.id] }),
}));

export const sessionsRelations = relations(sessions, ({ one }) => ({
  user: one(users, { fields: [sessions.userId], references: [users.id] }),
}));

export const documentsRelations = relations(documents, ({ one, many }) => ({
  owner: one(users, { fields: [documents.ownerId], references: [users.id] }),
  folder: one(folders, { fields: [documents.folderId], references: [folders.id] }),
  comments: many(comments),
  versions: many(documentVersions),
  tabs: many(tabs),
}));

export const tabsRelations = relations(tabs, ({ one, many }) => ({
  document: one(documents, {
    fields: [tabs.documentId],
    references: [documents.id],
  }),
  comments: many(comments),
}));

export const documentVersionsRelations = relations(
  documentVersions,
  ({ one }) => ({
    document: one(documents, {
      fields: [documentVersions.documentId],
      references: [documents.id],
    }),
    creator: one(users, {
      fields: [documentVersions.createdBy],
      references: [users.id],
    }),
  })
);

export const commentsRelations = relations(comments, ({ one }) => ({
  document: one(documents, {
    fields: [comments.documentId],
    references: [documents.id],
  }),
  tab: one(tabs, {
    fields: [comments.tabId],
    references: [tabs.id],
  }),
  author: one(users, { fields: [comments.authorId], references: [users.id] }),
}));
