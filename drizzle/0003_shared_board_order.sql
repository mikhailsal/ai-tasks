CREATE TABLE `board_columns` (
	`project_slug` text NOT NULL,
	`kind` text NOT NULL,
	`status_id` text NOT NULL,
	`revision` integer DEFAULT 1 NOT NULL,
	PRIMARY KEY(`project_slug`, `kind`, `status_id`),
	FOREIGN KEY (`project_slug`) REFERENCES `projects`(`slug`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "board_column_revision_positive" CHECK(typeof("board_columns"."revision") = 'integer' AND "board_columns"."revision" >= 1),
	CONSTRAINT "board_column_kind_valid" CHECK("board_columns"."kind" IN ('ordinary','recurring'))
);
--> statement-breakpoint
CREATE TABLE `board_order` (
	`task_id` text PRIMARY KEY NOT NULL,
	`project_slug` text NOT NULL,
	`kind` text NOT NULL,
	`status_id` text NOT NULL,
	`position` integer NOT NULL,
	FOREIGN KEY (`task_id`) REFERENCES `tasks`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`project_slug`) REFERENCES `projects`(`slug`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "board_order_position_positive" CHECK(typeof("board_order"."position") = 'integer' AND "board_order"."position" >= 1),
	CONSTRAINT "board_order_kind_valid" CHECK("board_order"."kind" IN ('ordinary','recurring'))
);
--> statement-breakpoint
CREATE INDEX `board_order_column_position` ON `board_order` (`project_slug`,`kind`,`status_id`,`position`,`task_id`);
--> statement-breakpoint
INSERT INTO `board_columns` (`project_slug`,`kind`,`status_id`,`revision`)
SELECT DISTINCT `project_slug`,`kind`,`status_id`,1 FROM `tasks`;
--> statement-breakpoint
INSERT INTO `board_order` (`task_id`,`project_slug`,`kind`,`status_id`,`position`)
SELECT `id`,`project_slug`,`kind`,`status_id`,
row_number() OVER (PARTITION BY `project_slug`,`kind`,`status_id` ORDER BY `created_at`,`id`)
FROM `tasks`;
