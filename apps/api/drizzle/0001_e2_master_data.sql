CREATE TABLE `branches` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`code` text NOT NULL,
	`name` text NOT NULL,
	`municipality_code` integer NOT NULL,
	`active` integer DEFAULT true NOT NULL,
	`deactivated_at` integer,
	`version` integer DEFAULT 1 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`created_by` text NOT NULL,
	`updated_by` text NOT NULL,
	FOREIGN KEY (`municipality_code`) REFERENCES `municipalities`(`ibge_code`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `branches_code_unique` ON `branches` (`code`);--> statement-breakpoint
CREATE TABLE `customer_branches` (
	`customer_id` integer NOT NULL,
	`branch_id` integer NOT NULL,
	PRIMARY KEY(`customer_id`, `branch_id`),
	FOREIGN KEY (`customer_id`) REFERENCES `customers`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`branch_id`) REFERENCES `branches`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `customer_branches_branch_id_idx` ON `customer_branches` (`branch_id`);--> statement-breakpoint
CREATE TABLE `customers` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`cnpj` text(14) NOT NULL,
	`legal_name` text NOT NULL,
	`trade_name` text,
	`state_code` integer NOT NULL,
	`municipality_code` integer NOT NULL,
	`neighborhood` text NOT NULL,
	`neighborhood_key` text NOT NULL,
	`retail_network_id` integer,
	`economic_group_id` integer,
	`active` integer DEFAULT true NOT NULL,
	`deactivated_at` integer,
	`version` integer DEFAULT 1 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`created_by` text NOT NULL,
	`updated_by` text NOT NULL,
	FOREIGN KEY (`state_code`) REFERENCES `states`(`ibge_code`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`municipality_code`) REFERENCES `municipalities`(`ibge_code`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`retail_network_id`) REFERENCES `retail_networks`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`economic_group_id`) REFERENCES `economic_groups`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `customers_cnpj_unique` ON `customers` (`cnpj`);--> statement-breakpoint
CREATE INDEX `customers_municipality_neighborhood_idx` ON `customers` (`municipality_code`,`neighborhood_key`);--> statement-breakpoint
CREATE INDEX `customers_retail_network_id_idx` ON `customers` (`retail_network_id`);--> statement-breakpoint
CREATE INDEX `customers_economic_group_id_idx` ON `customers` (`economic_group_id`);--> statement-breakpoint
CREATE TABLE `economic_groups` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`code` text NOT NULL,
	`name` text NOT NULL,
	`active` integer DEFAULT true NOT NULL,
	`deactivated_at` integer,
	`version` integer DEFAULT 1 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`created_by` text NOT NULL,
	`updated_by` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `economic_groups_code_unique` ON `economic_groups` (`code`);--> statement-breakpoint
CREATE TABLE `municipalities` (
	`ibge_code` integer PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`state_code` integer NOT NULL,
	FOREIGN KEY (`state_code`) REFERENCES `states`(`ibge_code`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `municipalities_state_code_name_idx` ON `municipalities` (`state_code`,`name`);--> statement-breakpoint
CREATE TABLE `product_subgroups` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`code` text NOT NULL,
	`name` text NOT NULL,
	`active` integer DEFAULT true NOT NULL,
	`deactivated_at` integer,
	`version` integer DEFAULT 1 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`created_by` text NOT NULL,
	`updated_by` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `product_subgroups_code_unique` ON `product_subgroups` (`code`);--> statement-breakpoint
CREATE TABLE `retail_networks` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`code` text NOT NULL,
	`name` text NOT NULL,
	`active` integer DEFAULT true NOT NULL,
	`deactivated_at` integer,
	`version` integer DEFAULT 1 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`created_by` text NOT NULL,
	`updated_by` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `retail_networks_code_unique` ON `retail_networks` (`code`);--> statement-breakpoint
CREATE TABLE `seller_branches` (
	`seller_id` integer NOT NULL,
	`branch_id` integer NOT NULL,
	PRIMARY KEY(`seller_id`, `branch_id`),
	FOREIGN KEY (`seller_id`) REFERENCES `sellers`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`branch_id`) REFERENCES `branches`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `seller_branches_branch_id_idx` ON `seller_branches` (`branch_id`);--> statement-breakpoint
CREATE TABLE `sellers` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`code` text NOT NULL,
	`name` text NOT NULL,
	`active` integer DEFAULT true NOT NULL,
	`deactivated_at` integer,
	`version` integer DEFAULT 1 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`created_by` text NOT NULL,
	`updated_by` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `sellers_code_unique` ON `sellers` (`code`);--> statement-breakpoint
CREATE TABLE `states` (
	`ibge_code` integer PRIMARY KEY NOT NULL,
	`uf` text(2) NOT NULL,
	`name` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `states_uf_unique` ON `states` (`uf`);