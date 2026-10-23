import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { z } from 'zod/mini';
import type { MetaData } from '../../../src/schema/meta.js';
import { Button } from '../components/Button.js';
import { CopyTextButton } from '../components/CopyTextButton.js';
import { errorMessage, readConfiguration, type projectEnvelopeSchema } from '../data/resources.js';
import { ProjectEditor } from './ProjectEditor.js';
import { ProjectLifecycle } from './ProjectLifecycle.js';
import { presetLabels } from './project-fields.js';
import { ProjectDescriptionPreview } from './ProjectDescriptionPreview.js';
import { boardReturnHref } from '../data/board-links.js';
import { AppLink, navigate } from '../app/router.js';
export function ProjectDetail({
  source,
  metadata,
  online,
  refresh,
}: {
  source: z.output<typeof projectEnvelopeSchema>;
  metadata: MetaData;
  online: boolean;
  refresh(): void;
}) {
  const params = new URLSearchParams(window.location.search);
  const kind = params.get('kind') === 'recurring' ? 'recurring' : 'ordinary';
  const back = boardReturnHref(source.data.slug, kind);
  const [editing, setEditing] = useState(params.get('edit') === 'true');
  const configuration = useQuery({
    queryKey: ['project-configuration', source.data.slug, source.data.config_revision],
    queryFn: ({ signal }) => readConfiguration(source.data.slug, signal),
  });
  if (editing)
    return (
      <ProjectEditor
        source={source}
        metadata={metadata}
        online={online}
        onCancel={() => navigate(back)}
        onSaved={() => {
          refresh();
          navigate(back);
        }}
      />
    );
  return (
    <>
      <AppLink href={back}>Назад на доску проекта</AppLink>
      <h1>
        {source.data.emoji} {source.data.name}
      </h1>
      <p className="subtle">
        Slug проекта: <span>{source.data.slug}</span>
      </p>
      <p>Приоритет проекта: {source.data.priority}</p>
      <CopyTextButton
        text={source.data.emoji}
        label="Скопировать эмодзи проекта"
        failure="Не удалось скопировать эмодзи. Выделите его и скопируйте вручную."
      />
      <div className="actions">
        {source.data.archived_at !== null ? (
          <section>
            <p role="status">
              Проект в архиве. Доступны чтение, история и восстановление. Редактирование и создание
              задач недоступны.
            </p>
            <Button disabled>Создать задачу</Button> <Button disabled>Редактировать проект</Button>
          </section>
        ) : (
          <>
            <Button onClick={() => setEditing(true)} disabled={!online}>
              Редактировать проект
            </Button>{' '}
            <a
              className="button button-primary"
              href={`/projects/${encodeURIComponent(source.data.slug)}/tasks/new`}
            >
              Создать задачу
            </a>
          </>
        )}
      </div>
      <h2>Описание проекта</h2>
      <p style={{ whiteSpace: 'pre-wrap' }}>
        {source.data.description || 'Описание пока не добавлено.'}
      </p>
      <ProjectDescriptionPreview
        slug={source.data.slug}
        description={source.data.description}
        disabled={!online}
      />
      {configuration.data && (
        <section aria-label="Настройки проекта">
          <h2>Настройки проекта</h2>
          <p>Модель приоритета: {presetLabels[configuration.data.data.priority_model.type]}</p>
          <p>
            Начальный статус задачи:{' '}
            {
              configuration.data.data.ordinary_workflow.statuses.find(
                (status) =>
                  status.id === configuration.data.data.ordinary_workflow.initial_status_id,
              )?.label
            }
          </p>
        </section>
      )}
      {configuration.error && <p role="alert">{errorMessage(configuration.error)}</p>}
      <p>
        <a href={back}>Задачи проекта</a>
      </p>
      <p>
        <AppLink href={`/audit?project_slug=${encodeURIComponent(source.data.slug)}`}>
          История проекта
        </AppLink>
      </p>
      <p>
        <a href={`/projects/${encodeURIComponent(source.data.slug)}/configuration`}>
          Настройки проекта
        </a>
      </p>
      <ProjectLifecycle source={source} metadata={metadata} online={online} onSaved={refresh} />
      <p>
        <a href="/projects">Все проекты</a>
      </p>
    </>
  );
}
