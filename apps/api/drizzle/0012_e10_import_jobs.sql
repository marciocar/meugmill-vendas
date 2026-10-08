CREATE TABLE `import_job_lines` (
	`job_id` integer NOT NULL,
	`line` integer NOT NULL,
	`status` text NOT NULL,
	`action` text,
	`activation` text,
	`error_code` text,
	`message` text,
	`warning` text,
	`target_id` integer,
	`target_version` integer,
	PRIMARY KEY(`job_id`, `line`),
	FOREIGN KEY (`job_id`) REFERENCES `import_jobs`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "import_job_lines_status_check" CHECK(status in ('valid', 'invalid', 'applied', 'failed'))
);
--> statement-breakpoint
CREATE TABLE `import_jobs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`layout` text NOT NULL,
	`status` text NOT NULL,
	`created_by` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`file_sha256` text NOT NULL,
	`file_bytes` integer NOT NULL,
	`actor_scope` text NOT NULL,
	`total_rows` integer DEFAULT 0 NOT NULL,
	`processed_rows` integer DEFAULT 0 NOT NULL,
	`error_rows` integer DEFAULT 0 NOT NULL,
	`counts` text DEFAULT '{}' NOT NULL,
	`file_error` text,
	`file_error_line` integer,
	`validated_at` integer,
	`expires_at` integer,
	`confirmed_by` text,
	`confirmed_at` integer,
	`finished_at` integer,
	CONSTRAINT "import_jobs_status_check" CHECK(status in ('validating', 'validated', 'invalid', 'applying', 'applied', 'partially_applied', 'failed', 'cancelled', 'expired', 'interrupted'))
);
--> statement-breakpoint
CREATE INDEX `import_jobs_created_by_id_idx` ON `import_jobs` (`created_by`,`id`);--> statement-breakpoint
CREATE INDEX `import_jobs_status_idx` ON `import_jobs` (`status`);