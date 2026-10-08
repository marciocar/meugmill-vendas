CREATE TABLE `portfolio_assignments` (
	`portfolio_id` integer NOT NULL,
	`customer_id` integer NOT NULL,
	`product_subgroup_id` integer NOT NULL,
	`seller_id` integer NOT NULL,
	`created_at` integer NOT NULL,
	`created_by` text NOT NULL,
	`updated_at` integer NOT NULL,
	`updated_by` text NOT NULL,
	PRIMARY KEY(`portfolio_id`, `customer_id`, `product_subgroup_id`),
	FOREIGN KEY (`portfolio_id`) REFERENCES `portfolios`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`customer_id`) REFERENCES `customers`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`product_subgroup_id`) REFERENCES `product_subgroups`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`seller_id`) REFERENCES `sellers`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `portfolio_assignments_portfolio_subgroup_seller_idx` ON `portfolio_assignments` (`portfolio_id`,`product_subgroup_id`,`seller_id`);--> statement-breakpoint
CREATE INDEX `portfolio_assignments_customer_id_idx` ON `portfolio_assignments` (`customer_id`);