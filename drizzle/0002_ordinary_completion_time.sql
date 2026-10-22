ALTER TABLE `tasks` ADD `completion_recorded_at` integer
  CONSTRAINT `task_completion_recorded_integer` CHECK (`completion_recorded_at` IS NULL OR typeof(`completion_recorded_at`) = 'integer')
  CONSTRAINT `task_recurring_completion_null` CHECK (`kind` != 'recurring' OR `completion_recorded_at` IS NULL);
--> statement-breakpoint
-- Only a complete, unique revision chain in one audit epoch proves a live task's
-- lineage. Retained restore branches and incomplete history deliberately stay unknown.
WITH history AS (
  SELECT a.entity_id, a.project_slug, a.database_epoch, a.timestamp, a.changes,
    json_extract(r.value, '$.after') AS revision
  FROM audit_records AS a, json_each(a.changes) AS r
  WHERE a.entity_type = 'task' AND json_extract(r.value, '$.field') = 'revision'
    AND json_type(r.value, '$.after') = 'integer'
    AND (SELECT count(*) FROM json_each(a.changes) AS v WHERE json_extract(v.value, '$.field') = 'revision') = 1
    AND ((json_extract(r.value, '$.after') = 1 AND json_type(r.value, '$.before') = 'null' AND a.action = 'task.create')
      OR (json_extract(r.value, '$.after') > 1 AND json_type(r.value, '$.before') = 'integer'
        AND json_extract(r.value, '$.before') = json_extract(r.value, '$.after') - 1))
), proven AS (
  SELECT t.id
  FROM tasks AS t JOIN history AS h ON h.entity_id = t.id AND h.project_slug = t.project_slug
  WHERE t.kind = 'ordinary'
  GROUP BY t.id
  HAVING count(*) = t.revision AND count(DISTINCT h.revision) = t.revision
    AND min(h.revision) = 1 AND max(h.revision) = t.revision
    AND count(DISTINCT h.database_epoch) = 1
    AND count(*) = (SELECT count(*) FROM audit_records AS a WHERE a.entity_type = 'task' AND a.entity_id = t.id)
)
UPDATE tasks SET completion_recorded_at = (
  SELECT h.timestamp FROM history AS h
  WHERE h.entity_id = tasks.id AND EXISTS (
    SELECT 1 FROM json_each(h.changes) AS c
    WHERE json_extract(c.value, '$.field') = 'category'
      AND json_extract(c.value, '$.after') = 'completed'
      AND json_extract(c.value, '$.before') IS NOT 'completed'
  ) ORDER BY h.revision DESC LIMIT 1
)
WHERE id IN (SELECT id FROM proven) AND EXISTS (
  SELECT 1 FROM projects AS p JOIN project_configs AS pc
    ON pc.project_slug = p.slug AND pc.revision = p.config_revision,
    json_each(pc.ordinary_workflow, '$.statuses') AS s
  WHERE p.slug = tasks.project_slug AND json_extract(s.value, '$.id') = tasks.status_id
    AND json_extract(s.value, '$.category') = 'completed'
);
