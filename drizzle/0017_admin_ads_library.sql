CREATE TABLE `ad_families` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`normalized_name` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`position` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_ad_families_normalized_name` ON `ad_families` (`normalized_name`);
--> statement-breakpoint
CREATE INDEX `idx_ad_families_position` ON `ad_families` (`position`);
--> statement-breakpoint
CREATE TABLE `ad_subtypes` (
	`id` text PRIMARY KEY NOT NULL,
	`family_id` text NOT NULL,
	`name` text NOT NULL,
	`normalized_name` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`position` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`family_id`) REFERENCES `ad_families`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_ad_subtypes_family_normalized_name` ON `ad_subtypes` (`family_id`,`normalized_name`);
--> statement-breakpoint
CREATE INDEX `idx_ad_subtypes_family_position` ON `ad_subtypes` (`family_id`,`position`);
--> statement-breakpoint
CREATE TABLE `ad_classifications` (
	`document_id` text NOT NULL,
	`section_uid` text NOT NULL,
	`family_id` text NOT NULL,
	`subtype_id` text NOT NULL,
	`updated_by` text NOT NULL,
	`updated_at` integer NOT NULL,
	PRIMARY KEY(`document_id`, `section_uid`),
	FOREIGN KEY (`document_id`) REFERENCES `documents`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`family_id`) REFERENCES `ad_families`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`subtype_id`) REFERENCES `ad_subtypes`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`updated_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE INDEX `idx_ad_classifications_family` ON `ad_classifications` (`family_id`);
--> statement-breakpoint
CREATE INDEX `idx_ad_classifications_subtype` ON `ad_classifications` (`subtype_id`);
