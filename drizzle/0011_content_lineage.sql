CREATE TABLE IF NOT EXISTS `content_lineages` (
	`id` text PRIMARY KEY NOT NULL,
	`document_id` text NOT NULL,
	`tab_id` text,
	`artifact_type` text NOT NULL,
	`current_number` integer,
	`current_title` text,
	`section_uid` text,
	`spine_id` text,
	`generation_run_id` text,
	`status` text DEFAULT 'active' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`last_seen_at` integer,
	FOREIGN KEY (`document_id`) REFERENCES `documents`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`tab_id`) REFERENCES `tabs`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_content_lineages_doc_type_number` ON `content_lineages` (`document_id`,`artifact_type`,`current_number`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_content_lineages_section` ON `content_lineages` (`document_id`,`section_uid`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_content_lineages_spine` ON `content_lineages` (`document_id`,`spine_id`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_content_lineages_doc_status` ON `content_lineages` (`document_id`,`status`);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `story_spines` (
	`id` text PRIMARY KEY NOT NULL,
	`document_id` text NOT NULL,
	`source_tab_id` text,
	`source_section_uid` text,
	`initial_episode_number` integer,
	`initial_title` text,
	`current_episode_number` integer,
	`current_title` text,
	`current_position_index` integer,
	`status` text DEFAULT 'active' NOT NULL,
	`replaces_spine_id` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`last_seen_at` integer,
	FOREIGN KEY (`document_id`) REFERENCES `documents`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`source_tab_id`) REFERENCES `tabs`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_story_spines_doc_section` ON `story_spines` (`document_id`,`source_section_uid`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_story_spines_doc_status` ON `story_spines` (`document_id`,`status`);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `story_spine_revisions` (
	`id` text PRIMARY KEY NOT NULL,
	`spine_id` text NOT NULL,
	`document_id` text NOT NULL,
	`tab_id` text,
	`section_uid` text,
	`episode_number` integer,
	`episode_title` text,
	`position_index` integer,
	`text_raw` text NOT NULL,
	`text_comparable` text NOT NULL,
	`text_hash` text NOT NULL,
	`text_length` integer NOT NULL,
	`snapshot_kind` text DEFAULT 'plot_saved' NOT NULL,
	`metadata_json` text,
	`created_by` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`spine_id`) REFERENCES `story_spines`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`document_id`) REFERENCES `documents`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`tab_id`) REFERENCES `tabs`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_story_spine_revisions_spine_created` ON `story_spine_revisions` (`spine_id`,`created_at`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_story_spine_revisions_doc_hash` ON `story_spine_revisions` (`document_id`,`text_hash`);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `generation_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`document_id` text NOT NULL,
	`spine_id` text,
	`spine_revision_id` text,
	`source_surface` text DEFAULT 'predefined_lab' NOT NULL,
	`target_episode_number` integer,
	`target_title` text,
	`writer_instruction_hash` text,
	`writer_instruction_length` integer,
	`selected_context_json` text,
	`model_id` text,
	`prompt_mode` text,
	`created_by` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`document_id`) REFERENCES `documents`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`spine_id`) REFERENCES `story_spines`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`spine_revision_id`) REFERENCES `story_spine_revisions`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_generation_runs_doc_created` ON `generation_runs` (`document_id`,`created_at`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_generation_runs_spine` ON `generation_runs` (`spine_id`);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `content_text_snapshots` (
	`id` text PRIMARY KEY NOT NULL,
	`lineage_id` text NOT NULL,
	`document_id` text NOT NULL,
	`tab_id` text,
	`artifact_type` text NOT NULL,
	`source_surface` text NOT NULL,
	`snapshot_kind` text NOT NULL,
	`snapshot_status` text DEFAULT 'active' NOT NULL,
	`source_id` text,
	`lab_run_id` text,
	`lab_turn_id` text,
	`parent_snapshot_id` text,
	`turn_index` integer,
	`episode_number` integer,
	`episode_title` text,
	`section_uid` text,
	`spine_id` text,
	`spine_revision_id` text,
	`generation_run_id` text,
	`position_index` integer,
	`match_confidence` text DEFAULT 'none' NOT NULL,
	`match_reason` text,
	`text_raw` text NOT NULL,
	`text_comparable` text NOT NULL,
	`text_hash` text NOT NULL,
	`text_length` integer NOT NULL,
	`metadata_json` text,
	`created_by` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`lineage_id`) REFERENCES `content_lineages`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`document_id`) REFERENCES `documents`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`tab_id`) REFERENCES `tabs`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`spine_id`) REFERENCES `story_spines`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`spine_revision_id`) REFERENCES `story_spine_revisions`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`generation_run_id`) REFERENCES `generation_runs`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_content_snapshots_lineage_created` ON `content_text_snapshots` (`lineage_id`,`created_at`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_content_snapshots_doc_kind` ON `content_text_snapshots` (`document_id`,`snapshot_kind`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_content_snapshots_source` ON `content_text_snapshots` (`source_surface`,`source_id`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_content_snapshots_spine` ON `content_text_snapshots` (`spine_id`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_content_snapshots_generation_run` ON `content_text_snapshots` (`generation_run_id`);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `content_export_events` (
	`id` text PRIMARY KEY NOT NULL,
	`document_id` text NOT NULL,
	`export_id` text NOT NULL,
	`export_url` text,
	`lineage_id` text,
	`snapshot_id` text,
	`previous_export_event_id` text,
	`changed_since_previous_export` integer DEFAULT true NOT NULL,
	`episode_number` integer,
	`episode_title` text,
	`section_uid` text,
	`spine_id` text,
	`spine_revision_id` text,
	`generation_run_id` text,
	`position_index` integer,
	`text_hash` text NOT NULL,
	`text_length` integer NOT NULL,
	`match_confidence` text DEFAULT 'none' NOT NULL,
	`match_reason` text,
	`created_by` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`document_id`) REFERENCES `documents`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`export_id`) REFERENCES `handoff_exports`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`lineage_id`) REFERENCES `content_lineages`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`snapshot_id`) REFERENCES `content_text_snapshots`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`spine_id`) REFERENCES `story_spines`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`spine_revision_id`) REFERENCES `story_spine_revisions`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`generation_run_id`) REFERENCES `generation_runs`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_content_export_events_doc_created` ON `content_export_events` (`document_id`,`created_at`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_content_export_events_export` ON `content_export_events` (`export_id`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_content_export_events_lineage` ON `content_export_events` (`lineage_id`);
