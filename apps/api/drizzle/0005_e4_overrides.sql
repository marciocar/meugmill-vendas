CREATE TABLE `portfolio_customer_overrides` (
	`portfolio_id` integer NOT NULL,
	`customer_id` integer NOT NULL,
	`kind` text NOT NULL,
	`created_at` integer NOT NULL,
	`created_by` text NOT NULL,
	PRIMARY KEY(`portfolio_id`, `customer_id`),
	FOREIGN KEY (`portfolio_id`) REFERENCES `portfolios`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`customer_id`) REFERENCES `customers`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "portfolio_customer_overrides_kind_check" CHECK("portfolio_customer_overrides"."kind" in ('include', 'exclude'))
);
--> statement-breakpoint
CREATE INDEX `portfolio_customer_overrides_customer_id_idx` ON `portfolio_customer_overrides` (`customer_id`);