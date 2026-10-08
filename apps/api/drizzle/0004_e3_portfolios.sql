CREATE TABLE `portfolio_economic_groups` (
	`portfolio_id` integer NOT NULL,
	`economic_group_id` integer NOT NULL,
	PRIMARY KEY(`portfolio_id`, `economic_group_id`),
	FOREIGN KEY (`portfolio_id`) REFERENCES `portfolios`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`economic_group_id`) REFERENCES `economic_groups`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `portfolio_regions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`portfolio_id` integer NOT NULL,
	`level` text NOT NULL,
	`state_code` integer NOT NULL,
	`municipality_code` integer,
	`neighborhood_key` text,
	`neighborhood_label` text,
	`region_key` text GENERATED ALWAYS AS ("level" || ':' || "state_code" || ':' || coalesce("municipality_code", 0) || ':' || coalesce("neighborhood_key", '')) STORED,
	FOREIGN KEY (`portfolio_id`) REFERENCES `portfolios`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`state_code`) REFERENCES `states`(`ibge_code`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`municipality_code`) REFERENCES `municipalities`(`ibge_code`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "portfolio_regions_level_check" CHECK(("portfolio_regions"."level" = 'state' and "portfolio_regions"."municipality_code" is null and "portfolio_regions"."neighborhood_key" is null and "portfolio_regions"."neighborhood_label" is null)
        or ("portfolio_regions"."level" = 'municipality' and "portfolio_regions"."municipality_code" is not null and "portfolio_regions"."neighborhood_key" is null and "portfolio_regions"."neighborhood_label" is null)
        or ("portfolio_regions"."level" = 'neighborhood' and "portfolio_regions"."municipality_code" is not null and "portfolio_regions"."neighborhood_key" is not null and "portfolio_regions"."neighborhood_key" <> '' and "portfolio_regions"."neighborhood_label" is not null))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `portfolio_regions_portfolio_id_region_key_unique` ON `portfolio_regions` (`portfolio_id`,`region_key`);--> statement-breakpoint
CREATE TABLE `portfolio_retail_networks` (
	`portfolio_id` integer NOT NULL,
	`retail_network_id` integer NOT NULL,
	PRIMARY KEY(`portfolio_id`, `retail_network_id`),
	FOREIGN KEY (`portfolio_id`) REFERENCES `portfolios`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`retail_network_id`) REFERENCES `retail_networks`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `portfolio_sellers` (
	`portfolio_id` integer NOT NULL,
	`seller_id` integer NOT NULL,
	`product_subgroup_id` integer NOT NULL,
	PRIMARY KEY(`portfolio_id`, `seller_id`, `product_subgroup_id`),
	FOREIGN KEY (`portfolio_id`) REFERENCES `portfolios`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`seller_id`) REFERENCES `sellers`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`product_subgroup_id`) REFERENCES `product_subgroups`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `portfolio_sellers_seller_id_idx` ON `portfolio_sellers` (`seller_id`);--> statement-breakpoint
CREATE INDEX `portfolio_sellers_product_subgroup_id_idx` ON `portfolio_sellers` (`product_subgroup_id`);--> statement-breakpoint
CREATE TABLE `portfolio_types` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`code` text NOT NULL,
	`name` text NOT NULL,
	`name_key` text DEFAULT '' NOT NULL,
	`active` integer DEFAULT true NOT NULL,
	`deactivated_at` integer,
	`version` integer DEFAULT 1 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`created_by` text NOT NULL,
	`updated_by` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `portfolio_types_code_unique` ON `portfolio_types` (`code`);--> statement-breakpoint
CREATE TABLE `portfolios` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`branch_id` integer NOT NULL,
	`name` text NOT NULL,
	`name_key` text DEFAULT '' NOT NULL,
	`description` text,
	`responsible_sub` text NOT NULL,
	`portfolio_type_id` integer NOT NULL,
	`status` text DEFAULT 'draft' NOT NULL,
	`active` integer DEFAULT true NOT NULL,
	`deactivated_at` integer,
	`version` integer DEFAULT 1 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`created_by` text NOT NULL,
	`updated_by` text NOT NULL,
	FOREIGN KEY (`branch_id`) REFERENCES `branches`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`portfolio_type_id`) REFERENCES `portfolio_types`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "portfolios_status_check" CHECK("portfolios"."status" in ('draft', 'active'))
);
--> statement-breakpoint
CREATE INDEX `portfolios_responsible_sub_idx` ON `portfolios` (`responsible_sub`);--> statement-breakpoint
CREATE INDEX `portfolios_portfolio_type_id_idx` ON `portfolios` (`portfolio_type_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `portfolios_branch_id_name_key_unique` ON `portfolios` (`branch_id`,`name_key`);