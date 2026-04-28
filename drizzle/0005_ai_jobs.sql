CREATE TABLE `ai_jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`document_id` text NOT NULL,
	`tab_id` text,
	`prompt_kind` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`model_id` text NOT NULL,
	`thinking` integer DEFAULT 0 NOT NULL,
	`context_snapshot` text,
	`result_json` text,
	`failure_reason` text,
	`created_by` text NOT NULL,
	`created_at` integer NOT NULL,
	`started_at` integer,
	`completed_at` integer,
	FOREIGN KEY (`document_id`) REFERENCES `documents`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`tab_id`) REFERENCES `tabs`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_ai_jobs_doc_status` ON `ai_jobs` (`document_id`,`status`);
--> statement-breakpoint
CREATE INDEX `idx_ai_jobs_status` ON `ai_jobs` (`status`);
