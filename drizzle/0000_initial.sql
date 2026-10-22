CREATE TABLE `application_state` (
	`id` integer PRIMARY KEY DEFAULT 1 NOT NULL,
	`database_epoch` text NOT NULL,
	`timezone` text DEFAULT 'Europe/Moscow' NOT NULL,
	`revision` integer DEFAULT 1 NOT NULL,
	`read_revision` integer DEFAULT 1 NOT NULL,
	`schema_version` integer DEFAULT 1 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	CONSTRAINT "application_singleton" CHECK("application_state"."id" = 1),
	CONSTRAINT "application_epoch_uuid" CHECK(instr("application_state"."database_epoch", char(0)) = 0 AND length("application_state"."database_epoch") = 36
    AND substr("application_state"."database_epoch", 9, 1) = '-' AND substr("application_state"."database_epoch", 14, 1) = '-'
    AND substr("application_state"."database_epoch", 19, 1) = '-' AND substr("application_state"."database_epoch", 24, 1) = '-'
    AND length(replace("application_state"."database_epoch", '-', '')) = 32
    AND replace("application_state"."database_epoch", '-', '') NOT GLOB '*[^0-9a-fA-F]*'),
	CONSTRAINT "application_revision_positive" CHECK(typeof("application_state"."revision") = 'integer' AND "application_state"."revision" >= 1),
	CONSTRAINT "application_read_revision_positive" CHECK(typeof("application_state"."read_revision") = 'integer' AND "application_state"."read_revision" >= 1),
	CONSTRAINT "application_schema_version" CHECK("application_state"."schema_version" = 1),
	CONSTRAINT "application_created_integer" CHECK(typeof("application_state"."created_at") = 'integer'),
	CONSTRAINT "application_updated_integer" CHECK(typeof("application_state"."updated_at") = 'integer')
);
--> statement-breakpoint
CREATE TABLE `project_configs` (
	`project_slug` text NOT NULL,
	`revision` integer NOT NULL,
	`priority_model` text NOT NULL,
	`ordinary_workflow` text NOT NULL,
	`recurring_workflow` text NOT NULL,
	`semantic_snapshot` text NOT NULL,
	`effective_at` integer NOT NULL,
	`actor` text NOT NULL,
	PRIMARY KEY(`project_slug`, `revision`),
	FOREIGN KEY (`project_slug`) REFERENCES `projects`(`slug`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "project_config_revision_positive" CHECK(typeof("project_configs"."revision") = 'integer' AND "project_configs"."revision" >= 1),
	CONSTRAINT "project_config_priority_json" CHECK(json_valid("project_configs"."priority_model")),
	CONSTRAINT "project_config_ordinary_json" CHECK(json_valid("project_configs"."ordinary_workflow")),
	CONSTRAINT "project_config_recurring_json" CHECK(json_valid("project_configs"."recurring_workflow")),
	CONSTRAINT "project_config_snapshot_json" CHECK(json_valid("project_configs"."semantic_snapshot")),
	CONSTRAINT "project_config_effective_integer" CHECK(typeof("project_configs"."effective_at") = 'integer'),
	CONSTRAINT "project_config_actor" CHECK("project_configs"."actor" = 'human-web' OR "project_configs"."actor" = 'ai-cli:' || "project_configs"."project_slug")
);
--> statement-breakpoint
CREATE TABLE `project_emoji_reservations` (
	`emoji_key` text PRIMARY KEY NOT NULL,
	`project_slug` text NOT NULL,
	`emoji` text NOT NULL,
	`first_reserved_at` integer NOT NULL,
	CONSTRAINT "project_reservation_scope" CHECK(instr("project_emoji_reservations"."project_slug", char(0)) = 0 AND length("project_emoji_reservations"."project_slug") BETWEEN 1 AND 64
    AND "project_emoji_reservations"."project_slug" NOT GLOB '*[^a-z0-9-]*'
    AND substr("project_emoji_reservations"."project_slug", 1, 1) != '-' AND substr("project_emoji_reservations"."project_slug", -1) != '-'
    AND instr("project_emoji_reservations"."project_slug", '--') = 0),
	CONSTRAINT "project_reservation_nondefault" CHECK(length("project_emoji_reservations"."emoji_key") > 0 AND "project_emoji_reservations"."emoji_key" != '⚪'),
	CONSTRAINT "project_reservation_time" CHECK(typeof("project_emoji_reservations"."first_reserved_at") = 'integer')
);
--> statement-breakpoint
CREATE TABLE `projects` (
	`id` text PRIMARY KEY NOT NULL,
	`slug` text NOT NULL,
	`name` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`emoji` text NOT NULL,
	`emoji_key` text NOT NULL,
	`priority` integer DEFAULT 0 NOT NULL,
	`revision` integer DEFAULT 1 NOT NULL,
	`config_revision` integer DEFAULT 1 NOT NULL,
	`archived_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	CONSTRAINT "project_id_uuid" CHECK(instr("projects"."id", char(0)) = 0 AND length("projects"."id") = 36
    AND substr("projects"."id", 9, 1) = '-' AND substr("projects"."id", 14, 1) = '-'
    AND substr("projects"."id", 19, 1) = '-' AND substr("projects"."id", 24, 1) = '-'
    AND length(replace("projects"."id", '-', '')) = 32
    AND replace("projects"."id", '-', '') NOT GLOB '*[^0-9a-fA-F]*'),
	CONSTRAINT "project_slug_valid" CHECK(instr("projects"."slug", char(0)) = 0 AND length("projects"."slug") BETWEEN 1 AND 64
    AND "projects"."slug" NOT GLOB '*[^a-z0-9-]*'
    AND substr("projects"."slug", 1, 1) != '-' AND substr("projects"."slug", -1) != '-'
    AND instr("projects"."slug", '--') = 0),
	CONSTRAINT "project_name_length" CHECK(length("projects"."name") BETWEEN 1 AND 80 AND length(trim("projects"."name")) > 0),
	CONSTRAINT "project_description_length" CHECK(length("projects"."description") <= 100000),
	CONSTRAINT "project_emoji_nondefault" CHECK(length("projects"."emoji_key") > 0 AND "projects"."emoji_key" != '⚪'),
	CONSTRAINT "project_priority_int32" CHECK(typeof("projects"."priority") = 'integer' AND "projects"."priority" BETWEEN -2147483648 AND 2147483647),
	CONSTRAINT "project_revision_positive" CHECK(typeof("projects"."revision") = 'integer' AND "projects"."revision" >= 1),
	CONSTRAINT "project_config_revision_positive" CHECK(typeof("projects"."config_revision") = 'integer' AND "projects"."config_revision" >= 1),
	CONSTRAINT "project_archive_integer" CHECK("projects"."archived_at" IS NULL OR typeof("projects"."archived_at") = 'integer'),
	CONSTRAINT "project_created_integer" CHECK(typeof("projects"."created_at") = 'integer'),
	CONSTRAINT "project_updated_integer" CHECK(typeof("projects"."updated_at") = 'integer')
);
--> statement-breakpoint
CREATE UNIQUE INDEX `projects_slug_unique` ON `projects` (`slug`);--> statement-breakpoint
CREATE UNIQUE INDEX `projects_emoji_key_unique` ON `projects` (`emoji_key`);--> statement-breakpoint
CREATE INDEX `projects_priority_slug` ON `projects` ("priority" desc,`slug`);--> statement-breakpoint
CREATE TABLE `task_emoji_reservations` (
	`project_slug` text NOT NULL,
	`emoji_key` text NOT NULL,
	`task_id` text NOT NULL,
	PRIMARY KEY(`project_slug`, `emoji_key`),
	FOREIGN KEY (`project_slug`,`task_id`) REFERENCES `tasks`(`project_slug`,`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "task_reservation_nondefault" CHECK(length("task_emoji_reservations"."emoji_key") > 0 AND "task_emoji_reservations"."emoji_key" != '⚪')
);
--> statement-breakpoint
CREATE UNIQUE INDEX `task_emoji_reservations_task_id_unique` ON `task_emoji_reservations` (`task_id`);--> statement-breakpoint
CREATE TABLE `tasks` (
	`id` text PRIMARY KEY NOT NULL,
	`project_slug` text NOT NULL,
	`kind` text NOT NULL,
	`title` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`description_html` text DEFAULT '' NOT NULL,
	`render_policy_version` integer DEFAULT 1 NOT NULL,
	`emoji` text DEFAULT '⚪' NOT NULL,
	`emoji_key` text DEFAULT '⚪' NOT NULL,
	`status_id` text NOT NULL,
	`priority` text,
	`priority_scaled` integer,
	`deadline` integer,
	`revision` integer DEFAULT 1 NOT NULL,
	`archived_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`project_slug`) REFERENCES `projects`(`slug`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "task_id_uuid" CHECK(instr("tasks"."id", char(0)) = 0 AND length("tasks"."id") = 36
    AND substr("tasks"."id", 9, 1) = '-' AND substr("tasks"."id", 14, 1) = '-'
    AND substr("tasks"."id", 19, 1) = '-' AND substr("tasks"."id", 24, 1) = '-'
    AND length(replace("tasks"."id", '-', '')) = 32
    AND replace("tasks"."id", '-', '') NOT GLOB '*[^0-9a-fA-F]*'),
	CONSTRAINT "task_kind_valid" CHECK("tasks"."kind" IN ('ordinary', 'recurring')),
	CONSTRAINT "task_title_length" CHECK(length("tasks"."title") BETWEEN 1 AND 300 AND length(trim("tasks"."title")) > 0),
	CONSTRAINT "task_description_length" CHECK(length("tasks"."description") <= 100000),
	CONSTRAINT "task_render_policy_positive" CHECK(typeof("tasks"."render_policy_version") = 'integer' AND "tasks"."render_policy_version" >= 1),
	CONSTRAINT "task_emoji_nonempty" CHECK(length("tasks"."emoji_key") > 0),
	CONSTRAINT "task_status_key" CHECK(instr("tasks"."status_id", char(0)) = 0 AND length("tasks"."status_id") > 0 AND "tasks"."status_id" NOT GLOB '*[^A-Za-z0-9_-]*'),
	CONSTRAINT "task_priority_json" CHECK("tasks"."priority" IS NULL OR json_valid("tasks"."priority")),
	CONSTRAINT "task_numeric_thousandths" CHECK("tasks"."priority_scaled" IS NULL OR (typeof("tasks"."priority_scaled") = 'integer' AND "tasks"."priority_scaled" BETWEEN -1000000000000 AND 1000000000000)),
	CONSTRAINT "task_deadline_integer" CHECK("tasks"."deadline" IS NULL OR typeof("tasks"."deadline") = 'integer'),
	CONSTRAINT "task_recurring_deadline_derived" CHECK("tasks"."kind" != 'recurring' OR "tasks"."deadline" IS NULL),
	CONSTRAINT "task_revision_positive" CHECK(typeof("tasks"."revision") = 'integer' AND "tasks"."revision" >= 1),
	CONSTRAINT "task_archive_integer" CHECK("tasks"."archived_at" IS NULL OR typeof("tasks"."archived_at") = 'integer'),
	CONSTRAINT "task_created_integer" CHECK(typeof("tasks"."created_at") = 'integer'),
	CONSTRAINT "task_updated_integer" CHECK(typeof("tasks"."updated_at") = 'integer')
);
--> statement-breakpoint
CREATE INDEX `tasks_project_list` ON `tasks` (`project_slug`,`kind`,`archived_at`,`status_id`,`deadline`,`created_at`,`id`);--> statement-breakpoint
CREATE INDEX `tasks_project_emoji` ON `tasks` (`project_slug`,`emoji_key`);--> statement-breakpoint
CREATE INDEX `tasks_global_emoji` ON `tasks` (`emoji_key`);--> statement-breakpoint
CREATE UNIQUE INDEX `tasks_project_id` ON `tasks` (`project_slug`,`id`);--> statement-breakpoint
CREATE UNIQUE INDEX `tasks_project_id_kind` ON `tasks` (`project_slug`,`id`,`kind`);--> statement-breakpoint
CREATE TABLE `task_dependencies` (
	`dependent_task_id` text NOT NULL,
	`dependent_project_slug` text NOT NULL,
	`dependent_kind` text DEFAULT 'ordinary' NOT NULL,
	`prerequisite_task_id` text NOT NULL,
	`prerequisite_project_slug` text NOT NULL,
	`prerequisite_kind` text DEFAULT 'ordinary' NOT NULL,
	`created_at` integer NOT NULL,
	`created_operation_id` text NOT NULL,
	PRIMARY KEY(`dependent_task_id`, `prerequisite_task_id`),
	FOREIGN KEY (`dependent_project_slug`,`dependent_task_id`,`dependent_kind`) REFERENCES `tasks`(`project_slug`,`id`,`kind`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`prerequisite_project_slug`,`prerequisite_task_id`,`prerequisite_kind`) REFERENCES `tasks`(`project_slug`,`id`,`kind`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "dependency_dependent_uuid" CHECK(instr("task_dependencies"."dependent_task_id", char(0)) = 0 AND length("task_dependencies"."dependent_task_id") = 36
    AND substr("task_dependencies"."dependent_task_id", 9, 1) = '-' AND substr("task_dependencies"."dependent_task_id", 14, 1) = '-'
    AND substr("task_dependencies"."dependent_task_id", 19, 1) = '-' AND substr("task_dependencies"."dependent_task_id", 24, 1) = '-'
    AND length(replace("task_dependencies"."dependent_task_id", '-', '')) = 32
    AND replace("task_dependencies"."dependent_task_id", '-', '') NOT GLOB '*[^0-9a-fA-F]*'),
	CONSTRAINT "dependency_prerequisite_uuid" CHECK(instr("task_dependencies"."prerequisite_task_id", char(0)) = 0 AND length("task_dependencies"."prerequisite_task_id") = 36
    AND substr("task_dependencies"."prerequisite_task_id", 9, 1) = '-' AND substr("task_dependencies"."prerequisite_task_id", 14, 1) = '-'
    AND substr("task_dependencies"."prerequisite_task_id", 19, 1) = '-' AND substr("task_dependencies"."prerequisite_task_id", 24, 1) = '-'
    AND length(replace("task_dependencies"."prerequisite_task_id", '-', '')) = 32
    AND replace("task_dependencies"."prerequisite_task_id", '-', '') NOT GLOB '*[^0-9a-fA-F]*'),
	CONSTRAINT "dependency_operation_uuid" CHECK(instr("task_dependencies"."created_operation_id", char(0)) = 0 AND length("task_dependencies"."created_operation_id") = 36
    AND substr("task_dependencies"."created_operation_id", 9, 1) = '-' AND substr("task_dependencies"."created_operation_id", 14, 1) = '-'
    AND substr("task_dependencies"."created_operation_id", 19, 1) = '-' AND substr("task_dependencies"."created_operation_id", 24, 1) = '-'
    AND length(replace("task_dependencies"."created_operation_id", '-', '')) = 32
    AND replace("task_dependencies"."created_operation_id", '-', '') NOT GLOB '*[^0-9a-fA-F]*'),
	CONSTRAINT "dependency_created_integer" CHECK(typeof("task_dependencies"."created_at") = 'integer'),
	CONSTRAINT "dependency_not_self" CHECK("task_dependencies"."dependent_task_id" != "task_dependencies"."prerequisite_task_id"),
	CONSTRAINT "dependency_ordinary_endpoints" CHECK("task_dependencies"."dependent_kind" = 'ordinary' AND "task_dependencies"."prerequisite_kind" = 'ordinary')
);
--> statement-breakpoint
CREATE INDEX `dependencies_reverse_idx` ON `task_dependencies` (`prerequisite_task_id`,`dependent_task_id`);--> statement-breakpoint
CREATE TABLE `occurrences` (
	`id` text PRIMARY KEY NOT NULL,
	`task_id` text NOT NULL,
	`project_slug` text NOT NULL,
	`generation_id` text NOT NULL,
	`occurrence_key` text NOT NULL,
	`deadline` integer NOT NULL,
	`expires_at` integer NOT NULL,
	`schedule_snapshot` text NOT NULL,
	`miss_policy` text NOT NULL,
	`confirmation_window_ms` integer NOT NULL,
	`description_snapshot` text NOT NULL,
	`description_html_snapshot` text NOT NULL,
	`render_policy_version` integer NOT NULL,
	`state` text NOT NULL,
	`revision` integer DEFAULT 1 NOT NULL,
	`actual_completed_at` integer,
	`completion_recorded_at` integer,
	`missed_at` integer,
	`cancelled_at` integer,
	`cancel_reason` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`project_slug`,`task_id`,`generation_id`) REFERENCES `schedule_generations`(`project_slug`,`task_id`,`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "occurrence_id_uuid" CHECK(instr("occurrences"."id", char(0)) = 0 AND length("occurrences"."id") = 36
    AND substr("occurrences"."id", 9, 1) = '-' AND substr("occurrences"."id", 14, 1) = '-'
    AND substr("occurrences"."id", 19, 1) = '-' AND substr("occurrences"."id", 24, 1) = '-'
    AND length(replace("occurrences"."id", '-', '')) = 32
    AND replace("occurrences"."id", '-', '') NOT GLOB '*[^0-9a-fA-F]*'),
	CONSTRAINT "occurrence_task_uuid" CHECK(instr("occurrences"."task_id", char(0)) = 0 AND length("occurrences"."task_id") = 36
    AND substr("occurrences"."task_id", 9, 1) = '-' AND substr("occurrences"."task_id", 14, 1) = '-'
    AND substr("occurrences"."task_id", 19, 1) = '-' AND substr("occurrences"."task_id", 24, 1) = '-'
    AND length(replace("occurrences"."task_id", '-', '')) = 32
    AND replace("occurrences"."task_id", '-', '') NOT GLOB '*[^0-9a-fA-F]*'),
	CONSTRAINT "occurrence_generation_uuid" CHECK(instr("occurrences"."generation_id", char(0)) = 0 AND length("occurrences"."generation_id") = 36
    AND substr("occurrences"."generation_id", 9, 1) = '-' AND substr("occurrences"."generation_id", 14, 1) = '-'
    AND substr("occurrences"."generation_id", 19, 1) = '-' AND substr("occurrences"."generation_id", 24, 1) = '-'
    AND length(replace("occurrences"."generation_id", '-', '')) = 32
    AND replace("occurrences"."generation_id", '-', '') NOT GLOB '*[^0-9a-fA-F]*'),
	CONSTRAINT "occurrence_nonempty_key" CHECK(length("occurrences"."occurrence_key") > 0),
	CONSTRAINT "occurrence_positive_revision" CHECK(typeof("occurrences"."revision") = 'integer' AND "occurrences"."revision" >= 1),
	CONSTRAINT "occurrence_positive_render_policy" CHECK(typeof("occurrences"."render_policy_version") = 'integer' AND "occurrences"."render_policy_version" >= 1),
	CONSTRAINT "occurrence_valid_schedule" CHECK(json_valid("occurrences"."schedule_snapshot")),
	CONSTRAINT "occurrence_valid_policy" CHECK("occurrences"."miss_policy" IN ('carry_forward', 'record_miss')),
	CONSTRAINT "occurrence_valid_window" CHECK(typeof("occurrences"."confirmation_window_ms") = 'integer' AND "occurrences"."confirmation_window_ms" BETWEEN 0 AND 2592000000),
	CONSTRAINT "occurrence_valid_state" CHECK("occurrences"."state" IN ('pending','completed','completed_late','debt','missed','cancelled')),
	CONSTRAINT "occurrence_expiry_endpoint" CHECK("occurrences"."expires_at" = "occurrences"."deadline" + "occurrences"."confirmation_window_ms"),
	CONSTRAINT "occurrence_integer_times" CHECK(typeof("occurrences"."deadline") = 'integer' AND typeof("occurrences"."expires_at") = 'integer' AND typeof("occurrences"."created_at") = 'integer'),
	CONSTRAINT "occurrence_nullable_times" CHECK(
    ("occurrences"."actual_completed_at" IS NULL OR typeof("occurrences"."actual_completed_at") = 'integer') AND
    ("occurrences"."completion_recorded_at" IS NULL OR typeof("occurrences"."completion_recorded_at") = 'integer') AND
    ("occurrences"."missed_at" IS NULL OR typeof("occurrences"."missed_at") = 'integer') AND
    ("occurrences"."cancelled_at" IS NULL OR typeof("occurrences"."cancelled_at") = 'integer')),
	CONSTRAINT "occurrence_completion_fields" CHECK(("occurrences"."state" IN ('completed','completed_late') AND "occurrences"."actual_completed_at" IS NOT NULL AND "occurrences"."completion_recorded_at" IS NOT NULL) OR ("occurrences"."state" NOT IN ('completed','completed_late') AND "occurrences"."actual_completed_at" IS NULL AND "occurrences"."completion_recorded_at" IS NULL)),
	CONSTRAINT "occurrence_miss_fields" CHECK(("occurrences"."state" IN ('debt','missed','completed_late') AND "occurrences"."missed_at" IS NOT NULL) OR ("occurrences"."state" NOT IN ('debt','missed','completed_late') AND "occurrences"."missed_at" IS NULL)),
	CONSTRAINT "occurrence_cancel_fields" CHECK(("occurrences"."state" = 'cancelled' AND "occurrences"."cancelled_at" IS NOT NULL AND "occurrences"."cancel_reason" IS NOT NULL AND length(trim("occurrences"."cancel_reason")) > 0) OR ("occurrences"."state" != 'cancelled' AND "occurrences"."cancelled_at" IS NULL AND "occurrences"."cancel_reason" IS NULL))
);
--> statement-breakpoint
CREATE INDEX `occurrences_task_state_deadline_idx` ON `occurrences` (`task_id`,`state`,`deadline`,`id`);--> statement-breakpoint
CREATE INDEX `occurrences_state_deadline_idx` ON `occurrences` (`state`,`deadline`,`id`);--> statement-breakpoint
CREATE INDEX `occurrences_expiry_idx` ON `occurrences` (`state`,`expires_at`,`id`);--> statement-breakpoint
CREATE UNIQUE INDEX `occurrence_generation_key_unique` ON `occurrences` (`generation_id`,`occurrence_key`);--> statement-breakpoint
CREATE UNIQUE INDEX `occurrence_owned_id_unique` ON `occurrences` (`project_slug`,`task_id`,`id`);--> statement-breakpoint
CREATE TABLE `recurrence_intervals` (
	`id` text PRIMARY KEY NOT NULL,
	`task_id` text NOT NULL,
	`project_slug` text NOT NULL,
	`start_at` integer NOT NULL,
	`end_at` integer,
	`behavior` text NOT NULL,
	`schedule_generation_id` text NOT NULL,
	FOREIGN KEY (`project_slug`,`task_id`) REFERENCES `tasks`(`project_slug`,`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`project_slug`,`task_id`,`schedule_generation_id`) REFERENCES `schedule_generations`(`project_slug`,`task_id`,`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "recurrence_interval_id_uuid" CHECK(instr("recurrence_intervals"."id", char(0)) = 0 AND length("recurrence_intervals"."id") = 36
    AND substr("recurrence_intervals"."id", 9, 1) = '-' AND substr("recurrence_intervals"."id", 14, 1) = '-'
    AND substr("recurrence_intervals"."id", 19, 1) = '-' AND substr("recurrence_intervals"."id", 24, 1) = '-'
    AND length(replace("recurrence_intervals"."id", '-', '')) = 32
    AND replace("recurrence_intervals"."id", '-', '') NOT GLOB '*[^0-9a-fA-F]*'),
	CONSTRAINT "recurrence_interval_task_uuid" CHECK(instr("recurrence_intervals"."task_id", char(0)) = 0 AND length("recurrence_intervals"."task_id") = 36
    AND substr("recurrence_intervals"."task_id", 9, 1) = '-' AND substr("recurrence_intervals"."task_id", 14, 1) = '-'
    AND substr("recurrence_intervals"."task_id", 19, 1) = '-' AND substr("recurrence_intervals"."task_id", 24, 1) = '-'
    AND length(replace("recurrence_intervals"."task_id", '-', '')) = 32
    AND replace("recurrence_intervals"."task_id", '-', '') NOT GLOB '*[^0-9a-fA-F]*'),
	CONSTRAINT "recurrence_interval_generation_uuid" CHECK(instr("recurrence_intervals"."schedule_generation_id", char(0)) = 0 AND length("recurrence_intervals"."schedule_generation_id") = 36
    AND substr("recurrence_intervals"."schedule_generation_id", 9, 1) = '-' AND substr("recurrence_intervals"."schedule_generation_id", 14, 1) = '-'
    AND substr("recurrence_intervals"."schedule_generation_id", 19, 1) = '-' AND substr("recurrence_intervals"."schedule_generation_id", 24, 1) = '-'
    AND length(replace("recurrence_intervals"."schedule_generation_id", '-', '')) = 32
    AND replace("recurrence_intervals"."schedule_generation_id", '-', '') NOT GLOB '*[^0-9a-fA-F]*'),
	CONSTRAINT "recurrence_interval_start_integer" CHECK(typeof("recurrence_intervals"."start_at") = 'integer'),
	CONSTRAINT "recurrence_interval_end_integer" CHECK("recurrence_intervals"."end_at" IS NULL OR typeof("recurrence_intervals"."end_at") = 'integer'),
	CONSTRAINT "recurrence_interval_half_open" CHECK("recurrence_intervals"."end_at" IS NULL OR "recurrence_intervals"."end_at" >= "recurrence_intervals"."start_at"),
	CONSTRAINT "recurrence_interval_behavior" CHECK("recurrence_intervals"."behavior" IN ('active','paused','archived'))
);
--> statement-breakpoint
CREATE INDEX `recurrence_intervals_parent_start_idx` ON `recurrence_intervals` (`project_slug`,`task_id`,`start_at`);--> statement-breakpoint
CREATE TABLE `recurrence_state` (
	`task_id` text NOT NULL,
	`project_slug` text NOT NULL,
	`current_generation_id` text NOT NULL,
	`cursor_anchor` integer,
	`waiting_predecessor_id` text,
	`next_candidate_at` integer,
	`revision` integer DEFAULT 1 NOT NULL,
	PRIMARY KEY(`project_slug`, `task_id`),
	FOREIGN KEY (`project_slug`,`task_id`) REFERENCES `tasks`(`project_slug`,`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`project_slug`,`task_id`,`current_generation_id`) REFERENCES `schedule_generations`(`project_slug`,`task_id`,`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`project_slug`,`task_id`,`waiting_predecessor_id`) REFERENCES `occurrences`(`project_slug`,`task_id`,`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "recurrence_state_task_uuid" CHECK(instr("recurrence_state"."task_id", char(0)) = 0 AND length("recurrence_state"."task_id") = 36
    AND substr("recurrence_state"."task_id", 9, 1) = '-' AND substr("recurrence_state"."task_id", 14, 1) = '-'
    AND substr("recurrence_state"."task_id", 19, 1) = '-' AND substr("recurrence_state"."task_id", 24, 1) = '-'
    AND length(replace("recurrence_state"."task_id", '-', '')) = 32
    AND replace("recurrence_state"."task_id", '-', '') NOT GLOB '*[^0-9a-fA-F]*'),
	CONSTRAINT "recurrence_state_generation_uuid" CHECK(instr("recurrence_state"."current_generation_id", char(0)) = 0 AND length("recurrence_state"."current_generation_id") = 36
    AND substr("recurrence_state"."current_generation_id", 9, 1) = '-' AND substr("recurrence_state"."current_generation_id", 14, 1) = '-'
    AND substr("recurrence_state"."current_generation_id", 19, 1) = '-' AND substr("recurrence_state"."current_generation_id", 24, 1) = '-'
    AND length(replace("recurrence_state"."current_generation_id", '-', '')) = 32
    AND replace("recurrence_state"."current_generation_id", '-', '') NOT GLOB '*[^0-9a-fA-F]*'),
	CONSTRAINT "recurrence_state_predecessor_uuid" CHECK("recurrence_state"."waiting_predecessor_id" IS NULL OR instr("recurrence_state"."waiting_predecessor_id", char(0)) = 0 AND length("recurrence_state"."waiting_predecessor_id") = 36
    AND substr("recurrence_state"."waiting_predecessor_id", 9, 1) = '-' AND substr("recurrence_state"."waiting_predecessor_id", 14, 1) = '-'
    AND substr("recurrence_state"."waiting_predecessor_id", 19, 1) = '-' AND substr("recurrence_state"."waiting_predecessor_id", 24, 1) = '-'
    AND length(replace("recurrence_state"."waiting_predecessor_id", '-', '')) = 32
    AND replace("recurrence_state"."waiting_predecessor_id", '-', '') NOT GLOB '*[^0-9a-fA-F]*'),
	CONSTRAINT "recurrence_state_revision" CHECK(typeof("recurrence_state"."revision") = 'integer' AND "recurrence_state"."revision" >= 1),
	CONSTRAINT "recurrence_state_cursor_integer" CHECK("recurrence_state"."cursor_anchor" IS NULL OR typeof("recurrence_state"."cursor_anchor") = 'integer'),
	CONSTRAINT "recurrence_state_candidate_integer" CHECK("recurrence_state"."next_candidate_at" IS NULL OR typeof("recurrence_state"."next_candidate_at") = 'integer')
);
--> statement-breakpoint
CREATE INDEX `recurrence_candidate_idx` ON `recurrence_state` (`next_candidate_at`,`project_slug`,`task_id`);--> statement-breakpoint
CREATE TABLE `schedule_generations` (
	`id` text PRIMARY KEY NOT NULL,
	`task_id` text NOT NULL,
	`project_slug` text NOT NULL,
	`task_kind` text DEFAULT 'recurring' NOT NULL,
	`generation_number` integer NOT NULL,
	`mode` text NOT NULL,
	`schedule` text NOT NULL,
	`first_deadline` integer NOT NULL,
	`timezone` text NOT NULL,
	`miss_policy` text NOT NULL,
	`window_ms` integer NOT NULL,
	`created_at` integer NOT NULL,
	`successor_generation_id` text,
	FOREIGN KEY (`project_slug`,`task_id`,`task_kind`) REFERENCES `tasks`(`project_slug`,`id`,`kind`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`project_slug`,`task_id`,`successor_generation_id`) REFERENCES `schedule_generations`(`project_slug`,`task_id`,`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "generation_id_uuid" CHECK(instr("schedule_generations"."id", char(0)) = 0 AND length("schedule_generations"."id") = 36
    AND substr("schedule_generations"."id", 9, 1) = '-' AND substr("schedule_generations"."id", 14, 1) = '-'
    AND substr("schedule_generations"."id", 19, 1) = '-' AND substr("schedule_generations"."id", 24, 1) = '-'
    AND length(replace("schedule_generations"."id", '-', '')) = 32
    AND replace("schedule_generations"."id", '-', '') NOT GLOB '*[^0-9a-fA-F]*'),
	CONSTRAINT "generation_task_uuid" CHECK(instr("schedule_generations"."task_id", char(0)) = 0 AND length("schedule_generations"."task_id") = 36
    AND substr("schedule_generations"."task_id", 9, 1) = '-' AND substr("schedule_generations"."task_id", 14, 1) = '-'
    AND substr("schedule_generations"."task_id", 19, 1) = '-' AND substr("schedule_generations"."task_id", 24, 1) = '-'
    AND length(replace("schedule_generations"."task_id", '-', '')) = 32
    AND replace("schedule_generations"."task_id", '-', '') NOT GLOB '*[^0-9a-fA-F]*'),
	CONSTRAINT "generation_successor_uuid" CHECK("schedule_generations"."successor_generation_id" IS NULL OR instr("schedule_generations"."successor_generation_id", char(0)) = 0 AND length("schedule_generations"."successor_generation_id") = 36
    AND substr("schedule_generations"."successor_generation_id", 9, 1) = '-' AND substr("schedule_generations"."successor_generation_id", 14, 1) = '-'
    AND substr("schedule_generations"."successor_generation_id", 19, 1) = '-' AND substr("schedule_generations"."successor_generation_id", 24, 1) = '-'
    AND length(replace("schedule_generations"."successor_generation_id", '-', '')) = 32
    AND replace("schedule_generations"."successor_generation_id", '-', '') NOT GLOB '*[^0-9a-fA-F]*'),
	CONSTRAINT "generation_positive_number" CHECK(typeof("schedule_generations"."generation_number") = 'integer' AND "schedule_generations"."generation_number" >= 1),
	CONSTRAINT "generation_recurring_parent" CHECK("schedule_generations"."task_kind" = 'recurring'),
	CONSTRAINT "generation_valid_mode" CHECK("schedule_generations"."mode" IN ('calendar', 'after_completion')),
	CONSTRAINT "generation_valid_schedule" CHECK(json_valid("schedule_generations"."schedule")),
	CONSTRAINT "generation_valid_policy" CHECK("schedule_generations"."miss_policy" IN ('carry_forward', 'record_miss')),
	CONSTRAINT "generation_valid_window" CHECK(typeof("schedule_generations"."window_ms") = 'integer' AND "schedule_generations"."window_ms" BETWEEN 0 AND 2592000000),
	CONSTRAINT "generation_integer_times" CHECK(typeof("schedule_generations"."first_deadline") = 'integer' AND typeof("schedule_generations"."created_at") = 'integer')
);
--> statement-breakpoint
CREATE UNIQUE INDEX `generation_parent_number_unique` ON `schedule_generations` (`task_id`,`generation_number`);--> statement-breakpoint
CREATE UNIQUE INDEX `generation_owned_id_unique` ON `schedule_generations` (`project_slug`,`task_id`,`id`);--> statement-breakpoint
CREATE TABLE `audit_records` (
	`id` text PRIMARY KEY NOT NULL,
	`operation_id` text NOT NULL,
	`project_slug` text NOT NULL,
	`entity_type` text NOT NULL,
	`entity_id` text NOT NULL,
	`actor` text NOT NULL,
	`origin` text DEFAULT 'cli' NOT NULL,
	`timestamp` integer NOT NULL,
	`action` text NOT NULL,
	`changes` text NOT NULL,
	`config_snapshot` text,
	`confirmation` text,
	`database_epoch` text NOT NULL,
	CONSTRAINT "audit_records_id_uuid" CHECK(instr("audit_records"."id", char(0)) = 0 AND length("audit_records"."id") = 36
    AND substr("audit_records"."id", 9, 1) = '-' AND substr("audit_records"."id", 14, 1) = '-'
    AND substr("audit_records"."id", 19, 1) = '-' AND substr("audit_records"."id", 24, 1) = '-'
    AND length(replace("audit_records"."id", '-', '')) = 32
    AND replace("audit_records"."id", '-', '') NOT GLOB '*[^0-9a-fA-F]*'),
	CONSTRAINT "audit_records_operation_id_uuid" CHECK(instr("audit_records"."operation_id", char(0)) = 0 AND length("audit_records"."operation_id") = 36
    AND substr("audit_records"."operation_id", 9, 1) = '-' AND substr("audit_records"."operation_id", 14, 1) = '-'
    AND substr("audit_records"."operation_id", 19, 1) = '-' AND substr("audit_records"."operation_id", 24, 1) = '-'
    AND length(replace("audit_records"."operation_id", '-', '')) = 32
    AND replace("audit_records"."operation_id", '-', '') NOT GLOB '*[^0-9a-fA-F]*'),
	CONSTRAINT "audit_records_database_epoch_uuid" CHECK(instr("audit_records"."database_epoch", char(0)) = 0 AND length("audit_records"."database_epoch") = 36
    AND substr("audit_records"."database_epoch", 9, 1) = '-' AND substr("audit_records"."database_epoch", 14, 1) = '-'
    AND substr("audit_records"."database_epoch", 19, 1) = '-' AND substr("audit_records"."database_epoch", 24, 1) = '-'
    AND length(replace("audit_records"."database_epoch", '-', '')) = 32
    AND replace("audit_records"."database_epoch", '-', '') NOT GLOB '*[^0-9a-fA-F]*'),
	CONSTRAINT "audit_records_project_slug_valid" CHECK(instr("audit_records"."project_slug", char(0)) = 0 AND length("audit_records"."project_slug") BETWEEN 1 AND 64
    AND "audit_records"."project_slug" NOT GLOB '*[^a-z0-9-]*'
    AND substr("audit_records"."project_slug", 1, 1) != '-' AND substr("audit_records"."project_slug", -1) != '-'
    AND instr("audit_records"."project_slug", '--') = 0),
	CONSTRAINT "audit_records_actor_valid" CHECK("audit_records"."actor" = 'human-web' OR (
    substr("audit_records"."actor", 1, 7) = 'ai-cli:'
    AND instr(substr("audit_records"."actor", 8), char(0)) = 0 AND length(substr("audit_records"."actor", 8)) BETWEEN 1 AND 64
    AND substr("audit_records"."actor", 8) NOT GLOB '*[^a-z0-9-]*'
    AND substr(substr("audit_records"."actor", 8), 1, 1) != '-' AND substr(substr("audit_records"."actor", 8), -1) != '-'
    AND instr(substr("audit_records"."actor", 8), '--') = 0)),
	CONSTRAINT "audit_records_timestamp_integer" CHECK(typeof("audit_records"."timestamp") = 'integer'),
	CONSTRAINT "audit_records_entity_type_nonempty" CHECK(length("audit_records"."entity_type") > 0),
	CONSTRAINT "audit_records_entity_id_uuid" CHECK(instr("audit_records"."entity_id", char(0)) = 0 AND length("audit_records"."entity_id") = 36
    AND substr("audit_records"."entity_id", 9, 1) = '-' AND substr("audit_records"."entity_id", 14, 1) = '-'
    AND substr("audit_records"."entity_id", 19, 1) = '-' AND substr("audit_records"."entity_id", 24, 1) = '-'
    AND length(replace("audit_records"."entity_id", '-', '')) = 32
    AND replace("audit_records"."entity_id", '-', '') NOT GLOB '*[^0-9a-fA-F]*'),
	CONSTRAINT "audit_records_action_nonempty" CHECK(length("audit_records"."action") > 0),
	CONSTRAINT "audit_records_origin_nonempty" CHECK(length("audit_records"."origin") > 0),
	CONSTRAINT "audit_records_changes_json" CHECK(json_valid("audit_records"."changes")),
	CONSTRAINT "audit_records_changes_array" CHECK(json_type("audit_records"."changes") = 'array'),
	CONSTRAINT "audit_records_config_snapshot_json" CHECK(json_valid("audit_records"."config_snapshot")),
	CONSTRAINT "audit_records_confirmation_json" CHECK(json_valid("audit_records"."confirmation"))
);
--> statement-breakpoint
CREATE INDEX `audit_records_project_timestamp_id_idx` ON `audit_records` (`project_slug`,"timestamp" DESC,"id" DESC);--> statement-breakpoint
CREATE INDEX `audit_records_operation_id_idx` ON `audit_records` (`operation_id`);--> statement-breakpoint
CREATE TABLE `operation_receipts` (
	`database_epoch` text NOT NULL,
	`operation_id` text NOT NULL,
	`request_hash` text NOT NULL,
	`actor` text NOT NULL,
	`project_slug` text NOT NULL,
	`operation` text NOT NULL,
	`result` text NOT NULL,
	`audit_ids` text NOT NULL,
	`committed_at` integer NOT NULL,
	PRIMARY KEY(`database_epoch`, `operation_id`),
	CONSTRAINT "operation_receipts_database_epoch_uuid" CHECK(instr("operation_receipts"."database_epoch", char(0)) = 0 AND length("operation_receipts"."database_epoch") = 36
    AND substr("operation_receipts"."database_epoch", 9, 1) = '-' AND substr("operation_receipts"."database_epoch", 14, 1) = '-'
    AND substr("operation_receipts"."database_epoch", 19, 1) = '-' AND substr("operation_receipts"."database_epoch", 24, 1) = '-'
    AND length(replace("operation_receipts"."database_epoch", '-', '')) = 32
    AND replace("operation_receipts"."database_epoch", '-', '') NOT GLOB '*[^0-9a-fA-F]*'),
	CONSTRAINT "operation_receipts_operation_id_uuid" CHECK(instr("operation_receipts"."operation_id", char(0)) = 0 AND length("operation_receipts"."operation_id") = 36
    AND substr("operation_receipts"."operation_id", 9, 1) = '-' AND substr("operation_receipts"."operation_id", 14, 1) = '-'
    AND substr("operation_receipts"."operation_id", 19, 1) = '-' AND substr("operation_receipts"."operation_id", 24, 1) = '-'
    AND length(replace("operation_receipts"."operation_id", '-', '')) = 32
    AND replace("operation_receipts"."operation_id", '-', '') NOT GLOB '*[^0-9a-fA-F]*'),
	CONSTRAINT "operation_receipts_request_hash_sha256" CHECK(length("operation_receipts"."request_hash") = 64 AND "operation_receipts"."request_hash" NOT GLOB '*[^0-9a-f]*'),
	CONSTRAINT "operation_receipts_actor_valid" CHECK("operation_receipts"."actor" = 'human-web' OR (
    substr("operation_receipts"."actor", 1, 7) = 'ai-cli:'
    AND instr(substr("operation_receipts"."actor", 8), char(0)) = 0 AND length(substr("operation_receipts"."actor", 8)) BETWEEN 1 AND 64
    AND substr("operation_receipts"."actor", 8) NOT GLOB '*[^a-z0-9-]*'
    AND substr(substr("operation_receipts"."actor", 8), 1, 1) != '-' AND substr(substr("operation_receipts"."actor", 8), -1) != '-'
    AND instr(substr("operation_receipts"."actor", 8), '--') = 0)),
	CONSTRAINT "operation_receipts_project_slug_valid" CHECK(instr("operation_receipts"."project_slug", char(0)) = 0 AND length("operation_receipts"."project_slug") BETWEEN 1 AND 64
    AND "operation_receipts"."project_slug" NOT GLOB '*[^a-z0-9-]*'
    AND substr("operation_receipts"."project_slug", 1, 1) != '-' AND substr("operation_receipts"."project_slug", -1) != '-'
    AND instr("operation_receipts"."project_slug", '--') = 0),
	CONSTRAINT "operation_receipts_operation_nonempty" CHECK(length("operation_receipts"."operation") > 0),
	CONSTRAINT "operation_receipts_result_json" CHECK(json_valid("operation_receipts"."result")),
	CONSTRAINT "operation_receipts_audit_ids_json" CHECK(json_valid("operation_receipts"."audit_ids")),
	CONSTRAINT "operation_receipts_audit_ids_array" CHECK(json_type("operation_receipts"."audit_ids") = 'array'),
	CONSTRAINT "operation_receipts_committed_at_integer" CHECK(typeof("operation_receipts"."committed_at") = 'integer')
);
--> statement-breakpoint
CREATE TRIGGER "audit_records_immutable_update" BEFORE UPDATE ON "audit_records" BEGIN SELECT RAISE(ABORT, 'immutable history'); END;
--> statement-breakpoint
CREATE TRIGGER "audit_records_immutable_delete" BEFORE DELETE ON "audit_records" BEGIN SELECT RAISE(ABORT, 'immutable history'); END;
--> statement-breakpoint
CREATE TRIGGER "project_configs_immutable_update" BEFORE UPDATE ON "project_configs" BEGIN SELECT RAISE(ABORT, 'immutable history'); END;
--> statement-breakpoint
CREATE TRIGGER "project_configs_immutable_delete" BEFORE DELETE ON "project_configs" BEGIN SELECT RAISE(ABORT, 'immutable history'); END;
--> statement-breakpoint
CREATE TRIGGER "operation_receipts_immutable_update" BEFORE UPDATE ON "operation_receipts" BEGIN SELECT RAISE(ABORT, 'immutable history'); END;
--> statement-breakpoint
CREATE TRIGGER "operation_receipts_immutable_delete" BEFORE DELETE ON "operation_receipts" BEGIN SELECT RAISE(ABORT, 'immutable history'); END;
--> statement-breakpoint
CREATE TRIGGER "project_emoji_reservations_immutable_update" BEFORE UPDATE ON "project_emoji_reservations" BEGIN SELECT RAISE(ABORT, 'immutable history'); END;
--> statement-breakpoint
CREATE TRIGGER "project_emoji_reservations_immutable_delete" BEFORE DELETE ON "project_emoji_reservations" BEGIN SELECT RAISE(ABORT, 'immutable history'); END;
--> statement-breakpoint
CREATE TRIGGER "projects_immutable_slug" BEFORE UPDATE OF "slug" ON "projects" BEGIN SELECT RAISE(ABORT, 'immutable project slug'); END;
--> statement-breakpoint
CREATE TRIGGER "schedule_generations_immutable_snapshot" BEFORE UPDATE OF "id","task_id","project_slug","task_kind","generation_number","mode","schedule","first_deadline","timezone","miss_policy","window_ms","created_at" ON "schedule_generations" BEGIN SELECT RAISE(ABORT, 'immutable generation snapshot'); END;
--> statement-breakpoint
CREATE TRIGGER "occurrences_immutable_snapshot" BEFORE UPDATE OF "id","task_id","project_slug","generation_id","occurrence_key","deadline","expires_at","schedule_snapshot","miss_policy","confirmation_window_ms","description_snapshot","created_at" ON "occurrences" BEGIN SELECT RAISE(ABORT, 'immutable occurrence snapshot'); END;
