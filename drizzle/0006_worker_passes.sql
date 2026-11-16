-- Spec 011: last completed recurring-worker pass per project. Operational state: written
-- only by the worker, not audited, not counted in read_revision, carried by backups.
CREATE TABLE `worker_passes` (
	`project_slug` text PRIMARY KEY NOT NULL,
	`last_pass_at` integer NOT NULL,
	FOREIGN KEY (`project_slug`) REFERENCES `projects`(`slug`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "worker_passes_last_pass_integer" CHECK(typeof("worker_passes"."last_pass_at") = 'integer')
);
