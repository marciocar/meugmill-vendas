CREATE INDEX `portfolio_links_portfolio_id_idx` ON `portfolio_links` (`portfolio_id`);--> statement-breakpoint
CREATE INDEX `portfolio_links_portfolio_customer_idx` ON `portfolio_links` (`portfolio_id`,`customer_id`);--> statement-breakpoint
CREATE INDEX `portfolio_links_customer_id_idx` ON `portfolio_links` (`customer_id`);