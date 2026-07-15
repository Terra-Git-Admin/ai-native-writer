CREATE INDEX `idx_tabs_doc_pos` ON `tabs` (`document_id`,`position`);--> statement-breakpoint
CREATE INDEX `idx_docver_doc_tab_created` ON `document_versions` (`document_id`,`tab_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `idx_comments_doc_tab` ON `comments` (`document_id`,`tab_id`);
