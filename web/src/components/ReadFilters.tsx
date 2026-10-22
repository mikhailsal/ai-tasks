import { useEffect, useState, type ReactNode } from 'react';
import { navigate, AppLink } from '../app/router.js';
import { categoryLabels } from './configuration-model.js';
import { Button } from './Button.js';
import { Field } from './Field.js';
import { SelectField as Choice } from './SelectField.js';
import { ReadPriorityFilter } from './ReadPriorityFilter.js';
import { appliedReadFilters, readFilterDraft, readFilterSearch } from './read-filters.js';

function FilterDetails({ children, open }: { children: ReactNode; open: boolean }) {
  return (
    <details open={open || undefined}>
      <summary className="button">Дополнительные фильтры</summary>
      <div className="stack">{children}</div>
    </details>
  );
}
export function ReadFilters({
  search,
  path,
  statistics = false,
}: {
  search: string;
  path: string;
  statistics?: boolean;
}) {
  const [draft, setDraft] = useState(() => readFilterDraft(search));
  const [error, setError] = useState('');
  const applied = appliedReadFilters(search, statistics);
  useEffect(() => {
    setDraft(readFilterDraft(search));
    setError('');
  }, [search]);
  return (
    <form
      aria-label="Фильтры задач"
      className="stack"
      onSubmit={(event) => {
        event.preventDefault();
        try {
          const query = readFilterSearch(draft, search, statistics);
          setError('');
          navigate(`${path}?${query}`);
        } catch (failure) {
          setError(failure instanceof Error ? failure.message : 'Проверьте фильтры.');
        }
      }}
    >
      <Field
        label="Поиск"
        value={draft.q}
        onChange={(event) => setDraft({ ...draft, q: event.target.value })}
        hint="Часть названия или исходного Markdown без учёта регистра. Знаки % и _ ищутся буквально."
      />
      <Choice
        allowUnknown
        label="Область задач"
        value={draft.scope}
        options={[
          ['all', 'Все проекты'],
          ['project', 'Один проект'],
        ]}
        onChange={(scope) => setDraft({ ...draft, scope })}
      />
      {draft.scope === 'project' && (
        <Field
          label="Slug проекта"
          value={draft.project}
          required
          onChange={(event) => setDraft({ ...draft, project: event.target.value })}
        />
      )}
      <AppLink href="/projects">Выбрать проект в списке</AppLink>
      <p aria-label="Применённые фильтры">
        {applied.scope}. {applied.archive}. {applied.visibility}.
      </p>
      <FilterDetails open={draft.priority.mode === 'invalid'}>
        <Choice
          allowUnknown
          label="Тип задачи"
          value={draft.kind}
          options={[
            ['', 'Все типы'],
            ['ordinary', 'Обычные'],
            ['recurring', 'Повторяющиеся'],
          ]}
          onChange={(kind) => setDraft({ ...draft, kind })}
        />
        <Field
          label="Идентификатор статуса"
          value={draft.status}
          onChange={(event) => setDraft({ ...draft, status: event.target.value })}
          hint="Стабильный ключ из настроек проекта; пустое поле — любой статус."
        />
        <Choice
          allowUnknown
          label="Категория статуса"
          value={draft.category}
          options={[['', 'Все категории'], ...Object.entries(categoryLabels)]}
          onChange={(category) => setDraft({ ...draft, category })}
        />
        <Field
          label="Эмодзи задачи"
          value={draft.emoji}
          onChange={(event) => setDraft({ ...draft, emoji: event.target.value })}
        />
        <ReadPriorityFilter
          value={draft.priority}
          onChange={(priority) => setDraft({ ...draft, priority })}
        />
        <Choice
          allowUnknown
          label="Архив"
          value={draft.archive}
          options={[
            ['exclude', 'Исключить архив'],
            ['include', 'Включая архив'],
            ['only', 'Только архив'],
          ]}
          onChange={(archive) => setDraft({ ...draft, archive })}
        />
        <Field
          label={statistics ? 'Включить отменённые' : 'Включить завершённые и отменённые'}
          type="checkbox"
          checked={draft.includeTerminal}
          onChange={(event) => setDraft({ ...draft, includeTerminal: event.target.checked })}
        />
        {!statistics && (
          <Field
            label="Размер страницы"
            type="number"
            min="1"
            max="200"
            step="1"
            required
            value={draft.limit}
            onChange={(event) => setDraft({ ...draft, limit: event.target.value })}
          />
        )}
      </FilterDetails>
      {error && <p role="alert">{error}</p>}
      <Button type="submit">Применить фильтры</Button>
    </form>
  );
}
