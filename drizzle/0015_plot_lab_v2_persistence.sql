CREATE TABLE `plot_lab_sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`document_id` text NOT NULL,
	`created_by` text NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`phase` text DEFAULT 'intake' NOT NULL,
	`revision` integer DEFAULT 0 NOT NULL,
	`orientation` text NOT NULL,
	`seed` text,
	`source_snapshot_json` text,
	`source_hashes_json` text,
	`references_json` text DEFAULT '[]' NOT NULL,
	`interview_checkpoint_json` text NOT NULL,
	`retcons_json` text DEFAULT '[]' NOT NULL,
	`latest_output_version` integer,
	`active_job_id` text,
	`pending_sync_action_id` text,
	`failed_stage` text,
	`prompt_versions_json` text DEFAULT '{}' NOT NULL,
	`model_assignments_json` text DEFAULT '{}' NOT NULL,
	`training_pack_version` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`archived_at` integer,
	FOREIGN KEY (`document_id`) REFERENCES `documents`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "plot_lab_sessions_revision_nonnegative" CHECK (`revision` >= 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_plot_lab_sessions_active_document` ON `plot_lab_sessions` (`document_id`) WHERE `status` = 'active';
--> statement-breakpoint
CREATE INDEX `idx_plot_lab_sessions_document_status_updated` ON `plot_lab_sessions` (`document_id`,`status`,`updated_at`);
--> statement-breakpoint
ALTER TABLE `ai_jobs` ADD `plot_lab_session_id` text REFERENCES `plot_lab_sessions`(`id`) ON DELETE SET NULL;
--> statement-breakpoint
ALTER TABLE `ai_jobs` ADD `concurrency_key` text;
--> statement-breakpoint
ALTER TABLE `ai_jobs` ADD `session_revision` integer;
--> statement-breakpoint
ALTER TABLE `ai_jobs` ADD `input_snapshot_json` text;
--> statement-breakpoint
ALTER TABLE `ai_jobs` ADD `current_stage` text;
--> statement-breakpoint
ALTER TABLE `ai_jobs` ADD `stage_checkpoint_json` text;
--> statement-breakpoint
ALTER TABLE `ai_jobs` ADD `stage_attempts_json` text;
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_ai_jobs_active_concurrency_key` ON `ai_jobs` (`concurrency_key`) WHERE `status` IN ('pending', 'running');
--> statement-breakpoint
CREATE INDEX `idx_ai_jobs_plot_lab_session` ON `ai_jobs` (`plot_lab_session_id`);
--> statement-breakpoint
CREATE TABLE `plot_lab_actions` (
	`id` text PRIMARY KEY NOT NULL,
	`action_id` text NOT NULL,
	`document_id` text NOT NULL,
	`session_id` text NOT NULL,
	`created_by` text NOT NULL,
	`request_hash` text NOT NULL,
	`action_kind` text NOT NULL,
	`base_revision` integer NOT NULL,
	`status` text NOT NULL,
	`request_json` text NOT NULL,
	`response_json` text,
	`job_id` text,
	`created_at` integer NOT NULL,
	`completed_at` integer,
	FOREIGN KEY (`document_id`) REFERENCES `documents`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`session_id`) REFERENCES `plot_lab_sessions`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`job_id`) REFERENCES `ai_jobs`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `plot_lab_actions_action_id_unique` ON `plot_lab_actions` (`action_id`);
--> statement-breakpoint
CREATE INDEX `idx_plot_lab_actions_session_created` ON `plot_lab_actions` (`session_id`,`created_at`);
--> statement-breakpoint
CREATE INDEX `idx_plot_lab_actions_document_created` ON `plot_lab_actions` (`document_id`,`created_at`);
--> statement-breakpoint
CREATE TABLE `plot_lab_messages` (
	`id` text PRIMARY KEY NOT NULL,
	`session_id` text NOT NULL,
	`sequence` integer NOT NULL,
	`role` text NOT NULL,
	`kind` text NOT NULL,
	`content` text NOT NULL,
	`payload_json` text,
	`action_id` text,
	`parent_message_id` text,
	`dependency_ids_json` text DEFAULT '[]' NOT NULL,
	`replay_scope` text NOT NULL,
	`superseded_at` integer,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`session_id`) REFERENCES `plot_lab_sessions`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_plot_lab_messages_session_sequence` ON `plot_lab_messages` (`session_id`,`sequence`);
--> statement-breakpoint
CREATE INDEX `idx_plot_lab_messages_parent` ON `plot_lab_messages` (`parent_message_id`);
--> statement-breakpoint
CREATE INDEX `idx_plot_lab_messages_action` ON `plot_lab_messages` (`action_id`);
--> statement-breakpoint
CREATE TABLE `plot_lab_proposals` (
	`id` text PRIMARY KEY NOT NULL,
	`session_id` text NOT NULL,
	`source_message_id` text NOT NULL,
	`base_output_version` integer NOT NULL,
	`instruction` text NOT NULL,
	`target_units_json` text NOT NULL,
	`downstream_units_json` text DEFAULT '[]' NOT NULL,
	`explanation` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`confirmed_choice` text,
	`created_at` integer NOT NULL,
	`resolved_at` integer,
	FOREIGN KEY (`session_id`) REFERENCES `plot_lab_sessions`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`source_message_id`) REFERENCES `plot_lab_messages`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_plot_lab_proposals_session_status` ON `plot_lab_proposals` (`session_id`,`status`);
--> statement-breakpoint
CREATE INDEX `idx_plot_lab_proposals_source_message` ON `plot_lab_proposals` (`source_message_id`);
--> statement-breakpoint
CREATE TABLE `plot_lab_outputs` (
	`id` text PRIMARY KEY NOT NULL,
	`session_id` text NOT NULL,
	`version` integer NOT NULL,
	`parent_version` integer,
	`job_id` text,
	`proposal_id` text,
	`status` text NOT NULL,
	`mutation_kind` text NOT NULL,
	`batch_json` text NOT NULL,
	`degraded_text` text,
	`created_at` integer NOT NULL,
	`superseded_at` integer,
	FOREIGN KEY (`session_id`) REFERENCES `plot_lab_sessions`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`job_id`) REFERENCES `ai_jobs`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`proposal_id`) REFERENCES `plot_lab_proposals`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_plot_lab_outputs_session_version` ON `plot_lab_outputs` (`session_id`,`version`);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_plot_lab_outputs_current_session` ON `plot_lab_outputs` (`session_id`) WHERE `status` = 'current';
--> statement-breakpoint
CREATE INDEX `idx_plot_lab_outputs_job` ON `plot_lab_outputs` (`job_id`);
--> statement-breakpoint
CREATE TABLE `plot_lab_feedback` (
	`id` text PRIMARY KEY NOT NULL,
	`session_id` text NOT NULL,
	`message_id` text,
	`output_version` integer NOT NULL,
	`unit_number` integer,
	`rating` text NOT NULL,
	`note` text,
	`prompt_versions_json` text NOT NULL,
	`model_assignments_json` text NOT NULL,
	`training_pack_version` text NOT NULL,
	`created_by` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`session_id`) REFERENCES `plot_lab_sessions`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`message_id`) REFERENCES `plot_lab_messages`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_plot_lab_feedback_session_output` ON `plot_lab_feedback` (`session_id`,`output_version`);
--> statement-breakpoint
CREATE INDEX `idx_plot_lab_feedback_message` ON `plot_lab_feedback` (`message_id`);
