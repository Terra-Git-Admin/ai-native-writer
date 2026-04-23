-- Add is_protected flag to tabs. The five canonical tabs seeded per document
-- (Original Research, Characters, Microdrama Plots, Predefined Episodes,
-- Workbook) carry is_protected=1 so title/type edits and deletion are
-- rejected at the API layer. All other rows default to 0.
ALTER TABLE `tabs` ADD `is_protected` integer DEFAULT 0 NOT NULL;
