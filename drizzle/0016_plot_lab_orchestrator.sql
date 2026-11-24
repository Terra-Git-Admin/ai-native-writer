ALTER TABLE `plot_lab_sessions` ADD `latest_accepted_output_version` integer;
--> statement-breakpoint
ALTER TABLE `plot_lab_proposals` ADD `repair_scope` text NOT NULL DEFAULT 'route';
--> statement-breakpoint
ALTER TABLE `plot_lab_outputs` ADD `accepted_at` integer;
--> statement-breakpoint
ALTER TABLE `plot_lab_outputs` ADD `accepted_by` text REFERENCES users(id) ON DELETE set null;
