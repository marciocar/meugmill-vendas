ALTER TABLE `sellers` ADD `user_sub` text;--> statement-breakpoint
CREATE UNIQUE INDEX `sellers_user_sub_unique` ON `sellers` (`user_sub`) WHERE "sellers"."user_sub" is not null;