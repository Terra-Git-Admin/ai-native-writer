CREATE TABLE `handoff_exports` (
	`id` text PRIMARY KEY NOT NULL,
	`document_id` text NOT NULL,
	`created_by` text NOT NULL,
	`export_json` text NOT NULL,
	`created_at` integer NOT NULL,
	`expires_at` integer NOT NULL,
	FOREIGN KEY (`document_id`) REFERENCES `documents`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_handoff_exports_doc` ON `handoff_exports` (`document_id`);
--> statement-breakpoint
CREATE INDEX `idx_handoff_exports_expires` ON `handoff_exports` (`expires_at`);
