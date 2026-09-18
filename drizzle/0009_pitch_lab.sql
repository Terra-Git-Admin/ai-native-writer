CREATE TABLE `pitch_ideas` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`title` text NOT NULL,
	`idea_text` text NOT NULL,
	`status` text DEFAULT 'generated' NOT NULL,
	`position` integer DEFAULT 0 NOT NULL,
	`promoted_document_id` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `pitch_workspaces`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_pitch_ideas_workspace_position` ON `pitch_ideas` (`workspace_id`,`position`);--> statement-breakpoint
CREATE TABLE `pitch_sources` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`type` text NOT NULL,
	`source_document_id` text,
	`source_tab_type` text,
	`title` text NOT NULL,
	`text_snapshot` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `pitch_workspaces`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_pitch_sources_workspace` ON `pitch_sources` (`workspace_id`);--> statement-breakpoint
CREATE TABLE `pitch_workspaces` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`brief` text DEFAULT '' NOT NULL,
	`adaptation_style` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`owner_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_pitch_workspaces_owner` ON `pitch_workspaces` (`owner_id`);
