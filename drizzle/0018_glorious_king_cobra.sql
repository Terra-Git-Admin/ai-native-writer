CREATE TABLE `predefined_bulk_run_items` (
	`id` text PRIMARY KEY NOT NULL,
	`run_id` text NOT NULL,
	`episode_number` integer NOT NULL,
	`episode_title` text NOT NULL,
	`position_index` integer NOT NULL,
	`plot_section_uid` text,
	`plot_text` text NOT NULL,
	`plot_hash` text NOT NULL,
	`prompt_text` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`current_stage` text DEFAULT 'pending' NOT NULL,
	`beats_output` text,
	`dialogue_output` text,
	`draft_output` text,
	`generation_run_id` text,
	`saved_section_uid` text,
	`attempt_count` integer DEFAULT 0 NOT NULL,
	`failure_reason` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`completed_at` integer,
	FOREIGN KEY (`run_id`) REFERENCES `predefined_bulk_runs`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`generation_run_id`) REFERENCES `generation_runs`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_predefined_bulk_items_run_episode` ON `predefined_bulk_run_items` (`run_id`,`episode_number`);--> statement-breakpoint
CREATE INDEX `idx_predefined_bulk_items_run_position` ON `predefined_bulk_run_items` (`run_id`,`position_index`);--> statement-breakpoint
CREATE INDEX `idx_predefined_bulk_items_generation_run` ON `predefined_bulk_run_items` (`generation_run_id`);--> statement-breakpoint
CREATE TABLE `predefined_bulk_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`document_id` text NOT NULL,
	`plot_tab_id` text NOT NULL,
	`predefined_tab_id` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`model_id` text NOT NULL,
	`thinking` integer DEFAULT true NOT NULL,
	`plan_hash` text NOT NULL,
	`total_items` integer NOT NULL,
	`completed_items` integer DEFAULT 0 NOT NULL,
	`skipped_items` integer DEFAULT 0 NOT NULL,
	`current_episode` integer,
	`failure_reason` text,
	`created_by` text NOT NULL,
	`created_at` integer NOT NULL,
	`started_at` integer,
	`completed_at` integer,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`document_id`) REFERENCES `documents`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`plot_tab_id`) REFERENCES `tabs`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`predefined_tab_id`) REFERENCES `tabs`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_predefined_bulk_runs_active_document` ON `predefined_bulk_runs` (`document_id`) WHERE "predefined_bulk_runs"."status" IN ('pending', 'running', 'paused');--> statement-breakpoint
CREATE INDEX `idx_predefined_bulk_runs_doc_created` ON `predefined_bulk_runs` (`document_id`,`created_at`);
