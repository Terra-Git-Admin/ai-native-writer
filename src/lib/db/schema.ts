import { sqliteTable, text, integer, primaryKey } from "drizzle-orm/sqlite-core";
import { relations } from "drizzle-orm";

export const users = sqliteTable("users", {
  id: text("id").primaryKey(),
  email: text("email").notNull().unique(),
  name: text("name"),
  image: text("image"),
  emailVerified: integer("email_verified", { mode: "timestamp" }),
  role: text("role", { enum: ["admin", "user"] }).notNull().default("user"),
  active: integer("active", { mode: "boolean" }).notNull().default(true),
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

export const documents = sqliteTable("documents", {
  id: text("id").primaryKey(),
  title: text("title").notNull().default("Untitled"),
  // Legacy single-blob content. Kept populated for backwards compat; tab
  // content is the source of truth going forward.
  content: text("content"),
  activeTabId: text("active_tab_id"),
  ownerId: text("owner_id")
    .notNull()
    .references(() => users.id),
  createdAt: integer("created_at", { mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date()),
  updatedAt: integer("updated_at", { mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date()),
});

export const tabs = sqliteTable("tabs", {
  id: text("id").primaryKey(),
  documentId: text("document_id")
    .notNull()
    .references(() => documents.id, { onDelete: "cascade" }),
  title: text("title").notNull().default("Untitled"),
  // 'custom' | 'series_overview' | 'characters' | 'episode_plot'
  // | 'reference_episode' | 'research'. Inferred from the title — writers
  // don't pick it.
  type: text("type").notNull().default("custom"),
  sequenceNumber: integer("sequence_number"),
  content: text("content"),
  position: integer("position").notNull().default(0),
  createdAt: integer("created_at", { mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date()),
  updatedAt: integer("updated_at", { mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date()),
});

export const comments = sqliteTable("comments", {
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
});

export const documentVersions = sqliteTable("document_versions", {
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
});

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
  id: text("id").primaryKey(), // "anthropic" or "google"
  apiKey: text("api_key").notNull(), // encrypted
  updatedAt: integer("updated_at", { mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date()),
});

// Relations
export const usersRelations = relations(users, ({ many }) => ({
  accounts: many(accounts),
  sessions: many(sessions),
  documents: many(documents),
  comments: many(comments),
}));

export const accountsRelations = relations(accounts, ({ one }) => ({
  user: one(users, { fields: [accounts.userId], references: [users.id] }),
}));

export const sessionsRelations = relations(sessions, ({ one }) => ({
  user: one(users, { fields: [sessions.userId], references: [users.id] }),
}));

export const documentsRelations = relations(documents, ({ one, many }) => ({
  owner: one(users, { fields: [documents.ownerId], references: [users.id] }),
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
