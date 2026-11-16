-- Spec 007: reasons for misses and notes on completions. Existing rows keep NULLs.
ALTER TABLE `occurrences` ADD `miss_reason` text;
--> statement-breakpoint
ALTER TABLE `occurrences` ADD `miss_reason_recorded_at` integer
  CONSTRAINT `occurrence_miss_reason_fields` CHECK ((`miss_reason` IS NULL AND `miss_reason_recorded_at` IS NULL) OR (`state` IN ('missed','completed_late') AND length(trim(`miss_reason`)) > 0 AND length(`miss_reason`) <= 500 AND typeof(`miss_reason_recorded_at`) = 'integer'));
--> statement-breakpoint
ALTER TABLE `occurrences` ADD `completion_note` text
  CONSTRAINT `occurrence_completion_note_fields` CHECK (`completion_note` IS NULL OR (`state` IN ('completed','completed_late') AND length(trim(`completion_note`)) > 0 AND length(`completion_note`) <= 500));
