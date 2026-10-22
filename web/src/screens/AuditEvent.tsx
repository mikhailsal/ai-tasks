import type { AuditResource } from '../../../src/schema/audit.js';
import { configurationDraft } from '../components/configuration-model.js';
import { ConfigurationSummary } from './ConfigurationSummary.js';
import {
  auditAction,
  auditField,
  auditValue,
  capturedConfiguration,
  previousSnapshot,
} from './audit-display.js';

export function AuditEvent({ event, timezone }: { event: AuditResource; timezone: string }) {
  const previous = previousSnapshot(event.config_snapshot);
  const oldConfig = capturedConfiguration(previous);
  const currentConfig = capturedConfiguration(event.config_snapshot);
  return (
    <article className="panel" aria-label={`Событие ${event.id}`}>
      <h2>{auditAction(event.action)}</h2>
      <p>
        <time dateTime={event.timestamp}>
          {new Intl.DateTimeFormat('ru-RU', {
            timeZone: timezone,
            dateStyle: 'medium',
            timeStyle: 'medium',
          }).format(new Date(event.timestamp))}
        </time>{' '}
        · {timezone}
      </p>
      <p>Точное время: {event.timestamp}</p>
      <dl>
        <dt>Проект</dt>
        <dd>{event.project_slug}</dd>
        <dt>Кто изменил</dt>
        <dd>
          {event.actor === 'human-web' ? 'Пользователь веб-интерфейса' : 'AI через CLI'} ·{' '}
          {event.actor}
        </dd>
        <dt>Источник</dt>
        <dd>
          {event.origin === 'web'
            ? 'Веб-интерфейс'
            : event.origin === 'cli'
              ? 'Командная строка'
              : event.origin}
        </dd>
        <dt>Сущность</dt>
        <dd>
          {event.entity_type} · {event.entity_id}
        </dd>
        <dt>Операция</dt>
        <dd>{event.operation_id}</dd>
        <dt>Версия сохранённой конфигурации</dt>
        <dd>{event.config_revision ?? 'Не записана'}</dd>
      </dl>
      {event.changes.map((change, index) => (
        <section
          key={`${change.field}:${index}`}
          aria-label={`Изменение: ${auditField(change.field)}`}
        >
          <h3>{auditField(change.field)}</h3>
          <dl>
            <dt>Было</dt>
            <dd>
              <pre>{auditValue(change.field, change.before, previous)}</pre>
            </dd>
            <dt>Стало</dt>
            <dd>
              <pre>{auditValue(change.field, change.after, event.config_snapshot)}</pre>
            </dd>
          </dl>
        </section>
      ))}
      {event.confirmation && (
        <section aria-label="Подтверждение пользователя">
          <h3>Подтверждение пользователя</h3>
          <p>Явное согласие на показанное изменение: да.</p>
          <pre>{event.confirmation.user_text}</pre>
        </section>
      )}
      <details>
        <summary>Сохранённый смысл статусов и приоритетов</summary>
        <p>Значения показаны по снимку в этом событии, независимо от текущих настроек проекта.</p>
        {oldConfig && previous !== event.config_snapshot && (
          <ConfigurationSummary label="Смысл до изменения" value={configurationDraft(oldConfig)} />
        )}
        {currentConfig ? (
          <ConfigurationSummary
            label="Сохранённые значения и правила"
            value={configurationDraft(currentConfig)}
          />
        ) : (
          <p>Снимок конфигурации не записан.</p>
        )}
      </details>
    </article>
  );
}
