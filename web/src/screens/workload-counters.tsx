import type { z } from 'zod/mini';
import { occurrenceStateSchema } from '../../../src/schema/recurrence-query.js';
import type { statisticsEnvelopeSchema } from '../../../src/schema/read-views.js';
import { categoryLabels, modelLabel } from '../data/view-format.js';
import { occurrenceLabels } from './occurrence-model.js';
type Statistics = z.infer<typeof statisticsEnvelopeSchema>['data'];
type Counts = Pick<Statistics, 'tasks' | 'ordinary' | 'occurrences'>;
function TaskCounts({ counts }: { counts: Counts }) {
  return (
    <>
      <p>Всего: {counts.tasks.total}</p>
      <p>Обычные: {counts.tasks.by_kind.ordinary}</p>
      <p>Повторяемые: {counts.tasks.by_kind.recurring}</p>
      <h3>Категории задач</h3>
      <ul>
        {Object.entries(counts.tasks.by_category).map(([key, count]) => (
          <li key={key}>
            {categoryLabels[key]}: {count}
          </li>
        ))}
      </ul>
      <h3>Обычная работа</h3>
      <p>Незавершённые обычные: {counts.ordinary.unfinished}</p>
      <p>Просроченные обычные: {counts.ordinary.overdue}</p>
      <p>Завершённые обычные: {counts.ordinary.completed}</p>
    </>
  );
}
function OccurrenceCounts({ counts }: { counts: Counts }) {
  return (
    <>
      <p>Всего: {counts.occurrences.total}</p>
      <ul>
        {occurrenceStateSchema.options.map((key) => {
          const label = occurrenceLabels[key];
          const value = counts.occurrences[key];
          return (
            <li key={key}>
              {label}: {value}
            </li>
          );
        })}
      </ul>
    </>
  );
}
export function WorkloadCounters({ data }: { data: Statistics }) {
  return (
    <>
      <section aria-label="Задачи" className="panel">
        <h2>Задачи</h2>
        <TaskCounts counts={data} />
      </section>
      <section aria-label="Повторения" className="panel">
        <h2>Повторения</h2>
        <p>Повторения считаются отдельно: они не увеличивают число задач.</p>
        <OccurrenceCounts counts={data} />
      </section>
      {data.groups.map((group) => (
        <section
          key={group.project.slug}
          aria-label={`Проект ${group.project.slug}`}
          className="panel"
        >
          <h2>
            {group.project.emoji} {group.project.name}
          </h2>
          <p>{modelLabel(group.priority_model)}</p>
          {group.project.archived_at !== null && <p>Проект в архиве</p>}
          <details>
            <summary>Показатели проекта</summary>
            <h3>Задачи проекта</h3>
            <TaskCounts counts={group} />
            <h3>Повторения проекта</h3>
            <OccurrenceCounts counts={group} />
          </details>
        </section>
      ))}
    </>
  );
}
