CREATE TABLE `portfolio_link_events` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`link_id` integer NOT NULL,
	`kind` text NOT NULL,
	`portfolio_id` integer NOT NULL,
	`branch_id` integer NOT NULL,
	`customer_id` integer NOT NULL,
	`product_subgroup_id` integer NOT NULL,
	`seller_id` integer NOT NULL,
	`occurred_at` integer NOT NULL,
	FOREIGN KEY (`link_id`) REFERENCES `portfolio_links`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "portfolio_link_events_kind_check" CHECK("portfolio_link_events"."kind" in ('created', 'ended'))
);
--> statement-breakpoint
CREATE INDEX `portfolio_link_events_branch_id_idx` ON `portfolio_link_events` (`branch_id`,`id`);--> statement-breakpoint
CREATE TABLE `portfolio_links` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`portfolio_id` integer NOT NULL,
	`branch_id` integer NOT NULL,
	`customer_id` integer NOT NULL,
	`product_subgroup_id` integer NOT NULL,
	`seller_id` integer NOT NULL,
	`active` integer DEFAULT true NOT NULL,
	`valid_from` integer NOT NULL,
	`valid_to` integer,
	`created_by` text NOT NULL,
	`ended_by` text,
	FOREIGN KEY (`portfolio_id`) REFERENCES `portfolios`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`branch_id`) REFERENCES `branches`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`customer_id`) REFERENCES `customers`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`product_subgroup_id`) REFERENCES `product_subgroups`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`seller_id`) REFERENCES `sellers`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `portfolio_links_active_cell_unique` ON `portfolio_links` (`branch_id`,`customer_id`,`product_subgroup_id`) WHERE "portfolio_links"."active" = 1;--> statement-breakpoint
CREATE INDEX `portfolio_links_portfolio_active_idx` ON `portfolio_links` (`portfolio_id`,`active`);--> statement-breakpoint
CREATE INDEX `portfolio_links_seller_id_idx` ON `portfolio_links` (`seller_id`);--> statement-breakpoint
ALTER TABLE `portfolios` ADD `finalized_at` integer;--> statement-breakpoint
ALTER TABLE `portfolios` ADD `finalized_by` text;