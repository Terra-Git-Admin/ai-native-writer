CREATE TABLE `ai_chat_history` (
	`id` text PRIMARY KEY NOT NULL,
	`document_id` text NOT NULL,
	`entry_type` text NOT NULL,
	`role` text,
	`content` text,
	`mode` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`document_id`) REFERENCES `documents`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `document_versions` (
	`id` text PRIMARY KEY NOT NULL,
	`document_id` text NOT NULL,
	`content` text NOT NULL,
	`created_by` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`document_id`) REFERENCES `documents`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `prompts` (
	`id` text PRIMARY KEY NOT NULL,
	`label` text NOT NULL,
	`content` text NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_ai_settings` (
	`id` text PRIMARY KEY NOT NULL,
	`api_key` text NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
INSERT INTO `__new_ai_settings`("id", "api_key", "updated_at") SELECT "id", "api_key", "updated_at" FROM `ai_settings`;--> statement-breakpoint
DROP TABLE `ai_settings`;--> statement-breakpoint
ALTER TABLE `__new_ai_settings` RENAME TO `ai_settings`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
ALTER TABLE `comments` ADD `quoted_text` text;--> statement-breakpoint
ALTER TABLE `users` ADD `email_verified` integer;