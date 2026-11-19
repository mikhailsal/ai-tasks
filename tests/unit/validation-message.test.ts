import { expect, it } from 'vitest';
import { ApiClientError } from '../../web/src/data/api.js';
import { errorMessage, invalidFields } from '../../web/src/data/resources.js';

const rejected = (...paths: (string | number)[][]) =>
  new ApiClientError({
    code: 'VALIDATION_ERROR',
    message: 'Invalid request',
    details: { issues: paths.map((path) => ({ code: 'custom', path })) },
    retryable: false,
  });

it('names a rejected field and its rule (QA F4)', () => {
  const error = rejected(['payload', 'emoji']);
  expect(invalidFields(error)).toEqual(['emoji']);
  expect(errorMessage(error)).toBe(
    'Проверьте поле «Эмодзи». Нужен ровно один эмодзи, например 🚀. Данные не сохранены.',
  );
});

it('says there are more fields when some have no label', () => {
  expect(errorMessage(rejected(['emoji'], ['config', 'stages', 0]))).toMatch(
    /^Проверьте поля «Эмодзи» и другие поля\./u,
  );
});

it('falls back to the general message when no field is known', () => {
  expect(errorMessage(rejected(['config']))).toBe(
    'Проверьте заполненные поля. Данные не сохранены.',
  );
});
