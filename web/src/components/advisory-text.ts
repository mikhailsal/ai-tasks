import type { Advisory } from '../../../src/schema/advisories.js';

type Labels = Readonly<Record<string, string>>;
type Remedy = { times: readonly string[]; advisory: Advisory; labels: Labels };
type Wording = { message: string; remedy(remedy: Remedy): string };

// Same wording as WorkerStatus, so the two notices read as one.
const workerRemedy: Wording['remedy'] = ({ advisory }) =>
  advisory.subject?.type === 'project'
    ? `Запустите сервис (serve), он запускает обработчик; вручную: worker run --project ${advisory.subject.id}.`
    : 'Запустите сервис (serve), он запускает обработчик.';

/**
 * Russian wording for people. The server's advisory text is fixed English for agents
 * (spec 010 FR-008), so the web interface translates by `code` and takes only the
 * times the remedy text carries. Codes added later fall back to the server's text.
 */
const wordings: Readonly<Record<string, Wording>> = {
  worker_stale: {
    message: 'Обработчик повторений давно не запускался; список повторений может быть неполным.',
    remedy: workerRemedy,
  },
  worker_never_ran: {
    message: 'Обработчик повторений ещё не запускался для этого проекта; повторения не создаются.',
    remedy: workerRemedy,
  },
  recurring_not_generating: {
    message: 'Задача в черновой стадии и пока не создаёт повторений.',
    remedy: ({ advisory, labels }) => {
      // The agent text lists the target status ids after the colon.
      const ids = /: ([a-z0-9_, -]+)\.$/u.exec(advisory.remedy.text)?.[1]?.split(', ') ?? [];
      const names = ids.map((id) => labels[id]);
      return ids.length > 0 && names.every(Boolean)
        ? `Переведите задачу в активную стадию: ${names.map((name) => `«${name ?? ''}»`).join(', ')}.`
        : 'Переведите задачу в активную стадию.';
    },
  },
  schedule_time_mismatch: {
    message: 'Время первого срока отличается от времени расписания.',
    remedy: ({ times: [first, later] }) =>
      first && later
        ? `Первый срок в ${first}, следующие повторения в ${later}.`
        : 'Проверьте время в настройках повторения.',
  },
  schedule_time_derived: {
    message: 'Время расписания взято из первого срока.',
    remedy: ({ times: [time] }) => (time ? `Повторения будут в ${time}.` : ''),
  },
};

function times(text: string): string[] {
  return [...text.matchAll(/\b(\d{2}:\d{2})(?::\d{2}(?:\.\d+)?)?\b/gu)].flatMap((match) =>
    match[1] ? [match[1]] : [],
  );
}

/** `labels` maps status ids to display names, where the screen knows them. */
export function advisoryText(
  advisory: Advisory,
  labels: Labels = {},
): { message: string; remedy: string } {
  const wording = Object.hasOwn(wordings, advisory.code) ? wordings[advisory.code] : undefined;
  if (!wording) return { message: advisory.message, remedy: advisory.remedy.text };
  return {
    message: wording.message,
    remedy: wording.remedy({ times: times(advisory.remedy.text), advisory, labels }),
  };
}
