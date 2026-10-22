import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { promoteImportedRegistrationSpecs } from '../../scripts/functional-sequencer.js';

it('promotes thin wrappers by registered fixture weight and preserves every other spec in base order', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'functional-sequencer-'));
  try {
    const tests = join(directory, 'tests/contracts');
    const fixtures = join(directory, 'tests/fixtures');
    await mkdir(tests, { recursive: true });
    await mkdir(fixtures, { recursive: true });
    await writeFile(
      join(fixtures, 'large-registrations.ts'),
      `import { describe, it } from 'vitest';\nexport function register(){describe('large',()=>{it('case',()=>{});});}\n${'// weight\n'.repeat(80)}`,
    );
    await writeFile(
      join(fixtures, 'small-registrations.ts'),
      `import { it as testCase } from 'vitest';\nexport function register(){testCase.each([1])('case %s',()=>{});}\n${'// weight\n'.repeat(20)}`,
    );
    await writeFile(join(fixtures, 'ordinary.ts'), `export const helper = () => true;`);
    const moduleIds = {
      ordinary: join(tests, 'ordinary.test.ts'),
      small: join(tests, 'small.test.ts'),
      missing: join(tests, 'missing.test.ts'),
      large: join(tests, 'large.test.ts'),
      local: join(tests, 'local.test.ts'),
    };
    await writeFile(
      moduleIds.ordinary,
      `import { helper } from '../fixtures/ordinary.js';\nvoid helper;`,
    );
    await writeFile(
      moduleIds.small,
      `import { register } from '../fixtures/small-registrations.js';\nregister();`,
    );
    await writeFile(
      moduleIds.missing,
      `import { register } from '../fixtures/not-created.js';\nregister();`,
    );
    await writeFile(
      moduleIds.large,
      `import { register } from '../fixtures/large-registrations.js';\nregister();`,
    );
    await writeFile(moduleIds.local, `import { it } from 'vitest';\nit('local',()=>{});`);
    const baseOrder = [
      { label: 'ordinary', moduleId: moduleIds.ordinary },
      { label: 'small-registration', moduleId: moduleIds.small },
      { label: 'missing-registration', moduleId: moduleIds.missing },
      { label: 'large-registration', moduleId: moduleIds.large },
      { label: 'local-registration', moduleId: moduleIds.local },
    ];

    const ordered = await promoteImportedRegistrationSpecs(baseOrder);

    expect(ordered.map(({ label }) => label)).toEqual([
      'large-registration',
      'small-registration',
      'ordinary',
      'missing-registration',
      'local-registration',
    ]);
    expect(new Set(ordered)).toEqual(new Set(baseOrder));
    expect(ordered).toHaveLength(baseOrder.length);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
