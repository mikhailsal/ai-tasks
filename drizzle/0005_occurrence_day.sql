-- Spec 008: project day rule, occurrence day, declared and recorded values.
-- occurrence_day of existing rows is filled by migrateDatabase (IANA zones need code).
ALTER TABLE `projects` ADD `day_start_hour` integer DEFAULT 0 NOT NULL
  CONSTRAINT `project_day_start_hour` CHECK (typeof(`day_start_hour`) = 'integer' AND `day_start_hour` BETWEEN 0 AND 23);
--> statement-breakpoint
ALTER TABLE `occurrences` ADD `occurrence_day` text
  CONSTRAINT `occurrence_day_format` CHECK (`occurrence_day` IS NULL OR `occurrence_day` GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]');
--> statement-breakpoint
ALTER TABLE `occurrences` ADD `recorded_values` text
  CONSTRAINT `occurrence_recorded_values_fields` CHECK (`recorded_values` IS NULL OR (`state` IN ('completed','completed_late') AND json_valid(`recorded_values`) AND json_type(`recorded_values`) = 'object'));
--> statement-breakpoint
ALTER TABLE `recurrence_state` ADD `value_declarations` text
  CONSTRAINT `recurrence_state_value_declarations` CHECK (`value_declarations` IS NULL OR (json_valid(`value_declarations`) AND json_type(`value_declarations`) = 'array' AND json_array_length(`value_declarations`) <= 8));
--> statement-breakpoint
CREATE INDEX `occurrences_task_day_idx` ON `occurrences` (`task_id`,`occurrence_day`);
