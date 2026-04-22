CREATE TABLE `tabs` (
	`id` text PRIMARY KEY NOT NULL,
	`document_id` text NOT NULL,
	`title` text DEFAULT 'Untitled' NOT NULL,
	`type` text DEFAULT 'custom' NOT NULL,
	`sequence_number` integer,
	`content` text,
	`position` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`document_id`) REFERENCES `documents`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
ALTER TABLE `documents` ADD `active_tab_id` text;--> statement-breakpoint
ALTER TABLE `comments` ADD `tab_id` text;--> statement-breakpoint
INSERT INTO `tabs` (id, document_id, title, type, content, position, created_at, updated_at)
SELECT
	lower(hex(randomblob(6))),
	d.id,
	'Main',
	'custom',
	d.content,
	0,
	unixepoch(),
	unixepoch()
FROM `documents` d;--> statement-breakpoint
UPDATE `documents` SET `active_tab_id` = (
	SELECT t.id FROM `tabs` t WHERE t.document_id = `documents`.id LIMIT 1
);--> statement-breakpoint
UPDATE `comments` SET `tab_id` = (
	SELECT t.id FROM `tabs` t WHERE t.document_id = `comments`.document_id LIMIT 1
) WHERE `tab_id` IS NULL;
