CREATE TABLE `folders` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`name` text NOT NULL,
	`normalized_name` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`owner_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_folders_owner_normalized_name` ON `folders` (`owner_id`,`normalized_name`);
--> statement-breakpoint
CREATE INDEX `idx_folders_owner` ON `folders` (`owner_id`);
--> statement-breakpoint
ALTER TABLE `documents` ADD `folder_id` text REFERENCES folders(id) ON DELETE SET NULL;
--> statement-breakpoint
ALTER TABLE `documents` ADD `archived_at` integer;
--> statement-breakpoint
CREATE INDEX `idx_documents_owner_archived` ON `documents` (`owner_id`,`archived_at`);
--> statement-breakpoint
CREATE INDEX `idx_documents_folder` ON `documents` (`folder_id`);
