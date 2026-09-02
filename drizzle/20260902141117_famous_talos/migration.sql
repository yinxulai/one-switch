CREATE TABLE `workflows` (
	`id` text PRIMARY KEY,
	`name` text NOT NULL,
	`type` text NOT NULL,
	`version` integer NOT NULL,
	`definition` text NOT NULL,
	`createdTime` integer NOT NULL,
	`updatedTime` integer NOT NULL,
	`deletedTime` integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_workflows_type_version` ON `workflows` (`type`,`version`);--> statement-breakpoint
CREATE INDEX `idx_workflows_type` ON `workflows` (`type`,`deletedTime`);--> statement-breakpoint
CREATE INDEX `idx_workflows_deleted_time` ON `workflows` (`deletedTime`);
