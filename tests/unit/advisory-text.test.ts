import { describe, expect, it } from 'vitest';
import { advisoryCodes } from '../../src/core/advisories/catalogue.js';
import type { Advisory } from '../../src/schema/advisories.js';
import { advisoryText } from '../../web/src/components/advisory-text.js';

const advisory = (code: string, text: string): Advisory => ({
  code,
  message: 'English text for agents.',
  remedy: { action: 'no_action', text },
});

describe('web advisory wording', () => {
  it('has Russian text for every catalogue code, without raw status keys or English', () => {
    for (const code of advisoryCodes) {
      const text = advisoryText(
        advisory(code, 'Move it to an active status: in_progress. 09:30:00 then 10:15:00'),
      );
      expect(text.message).toMatch(/\p{Script=Cyrillic}/u);
      expect(`${text.message} ${text.remedy}`).not.toMatch(/in_progress|status|Move it/u);
    }
  });
  it('keeps the times a remedy carries, to the minute', () => {
    const text = advisoryText(
      advisory(
        'schedule_time_mismatch',
        'The first deadline is at 09:30:00.000 local time; later occurrences use 10:15.',
      ),
    );
    expect(text.remedy).toBe('Первый срок в 09:30, следующие повторения в 10:15.');
  });
  it('names target statuses by their labels when the screen knows them', () => {
    const draft = advisory(
      'recurring_not_generating',
      'Move it to an active status: active, doing.',
    );
    expect(advisoryText(draft, { active: 'Активно', doing: 'В работе' }).remedy).toBe(
      'Переведите задачу в активную стадию: «Активно», «В работе».',
    );
    expect(advisoryText(draft, { active: 'Активно' }).remedy).toBe(
      'Переведите задачу в активную стадию.',
    );
  });
  it('names the project in the worker remedy', () => {
    const text = advisoryText({
      ...advisory('worker_stale', 'Start the service (serve)'),
      subject: { type: 'project', id: 'alpha' },
    });
    expect(text.remedy).toContain('worker run --project alpha');
  });
  it('falls back to the server text for a code added later', () => {
    expect(advisoryText(advisory('future_code', 'Do X.'))).toEqual({
      message: 'English text for agents.',
      remedy: 'Do X.',
    });
  });
});
