import { afterEach, beforeEach, expect, it } from 'vitest';
import { previewConfiguration } from '../../src/core/projects/configuration.js';
import { createProject } from '../../src/core/projects/commands.js';
import { createDefaultProjectConfig } from '../../src/core/projects/presets.js';
import {
  createOrdinaryFixture,
  ordinaryInput,
  ordinarySnapshot,
  type OrdinaryFixture,
} from '../fixtures/ordinary-work.js';

let fixture: OrdinaryFixture;
beforeEach(async () => {
  fixture = await createOrdinaryFixture();
  createProject(
    fixture.human,
    'alpha',
    ordinaryInput(fixture, { slug: 'alpha', name: 'Альфа', emoji: '🚀' }),
  );
});
afterEach(() => fixture?.close());

function proposal() {
  return {
    config: createDefaultProjectConfig(),
    status_mappings: [],
    priority_mappings: [],
    affected_tasks: [],
  };
}

it('normalizes an oversized direct preview request into the domain validation contract', () => {
  const before = ordinarySnapshot(fixture);
  expect(() =>
    previewConfiguration(fixture.human, 'alpha', { ...proposal(), extra: 'x'.repeat(1_048_576) }),
  ).toThrowError(expect.objectContaining({ code: 'VALIDATION_ERROR' }));
  expect(ordinarySnapshot(fixture)).toEqual(before);
});

it('rejects every own unknown preview field, including __proto__, without losing its identity', () => {
  const input = Object.defineProperty(proposal(), '__proto__', {
    value: { changed: true },
    enumerable: true,
  });
  expect(Object.hasOwn(input, '__proto__')).toBe(true);
  const before = ordinarySnapshot(fixture);
  expect(() => previewConfiguration(fixture.human, 'alpha', input)).toThrowError(
    expect.objectContaining({ code: 'VALIDATION_ERROR' }),
  );
  expect(Object.hasOwn(input, '__proto__')).toBe(true);
  expect(ordinarySnapshot(fixture)).toEqual(before);
});
