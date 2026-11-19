import { describe, expect, it } from 'vitest';
import { followName, slugFromName } from '../../web/src/screens/project-slug.js';
import { slugSchema } from '../../src/schema/values.js';

describe('project slug from its name', () => {
  it.each([
    ['Запуск нового продукта', 'zapusk-novogo-produkta'],
    ['Щука и ёж — 2026!', 'shchuka-i-ezh-2026'],
    ['Café Déjà Vu', 'cafe-deja-vu'],
    ['  --Объявления--  ', 'obyavleniya'],
    ['🚀✨', ''],
  ])('%j becomes %j', (name, slug) => {
    expect(slugFromName(name)).toBe(slug);
  });
  it('always fits the slug schema when not empty', () => {
    for (const name of ['Я'.repeat(100), 'a-'.repeat(50), 'Ёлка 🎄 и шар']) {
      const slug = slugFromName(name);
      expect(slugSchema.safeParse(slug).success).toBe(true);
    }
  });
  it('follows the name until a different slug is typed', () => {
    expect(followName({ name: '', slug: '' }, 'Дом')).toBe('dom');
    expect(followName({ name: 'Дом', slug: 'dom' }, 'Дом 2')).toBe('dom-2');
    expect(followName({ name: 'Дом', slug: 'my-home' }, 'Дом 2')).toBe('my-home');
  });
});
