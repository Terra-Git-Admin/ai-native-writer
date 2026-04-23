-- Add tabId to document_versions so snapshots are scoped per-tab. Pre-tabs rows
-- keep tab_id NULL (they snapshot the old pre-tabs blob on documents.content).
-- Writers edit inside a tab post-PR#15, so every new snapshot must record which
-- tab it captured.
ALTER TABLE `document_versions` ADD `tab_id` text REFERENCES `tabs`(`id`) ON DELETE CASCADE;
