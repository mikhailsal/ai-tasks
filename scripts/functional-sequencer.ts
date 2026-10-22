import { readFile, stat } from 'node:fs/promises';
import { dirname, isAbsolute, resolve } from 'node:path';
import ts from 'typescript';
import { BaseSequencer, type TestSpecification } from 'vitest/node';

type ModuleSpecification = { moduleId: string };

const registrationNames = new Set(['describe', 'it', 'suite', 'test']);

/** Promote thin test wrappers by the source weight of imported fixture registrations. */
export async function promoteImportedRegistrationSpecs<Specification extends ModuleSpecification>(
  specifications: readonly Specification[],
): Promise<Specification[]> {
  const fileCache = new Map<string, Promise<{ source: string; size: number } | undefined>>();
  const readModule = (path: string) => {
    const existing = fileCache.get(path);
    if (existing) return existing;
    const reading = Promise.all([readFile(path, 'utf8'), stat(path)])
      .then(([source, info]) => ({ source, size: info.size }))
      .catch(() => undefined);
    fileCache.set(path, reading);
    return reading;
  };

  const priorities = await Promise.all(
    specifications.map(async (specification) => {
      const moduleId = sourcePath(specification.moduleId);
      const testModule = await readModule(moduleId);
      if (!testModule) return 0;
      const fixtures = importedFixturePaths(moduleId, testModule.source);
      const registeredSizes = await Promise.all(
        fixtures.map(async (candidates) => {
          for (const fixture of candidates) {
            const module = await readModule(fixture);
            if (module) return hasVitestRegistrations(fixture, module.source) ? module.size : 0;
          }
          return 0;
        }),
      );
      const helperWeight = registeredSizes.reduce((total, size) => total + size, 0);
      return /\.(?:test|spec)\.[cm]?[jt]sx?$/u.test(moduleId) && testModule.size < helperWeight
        ? helperWeight
        : 0;
    }),
  );

  return specifications
    .map((specification, index) => ({ specification, index, weight: priorities[index] ?? 0 }))
    .sort((left, right) => {
      if (left.weight > 0 && right.weight === 0) return -1;
      if (left.weight === 0 && right.weight > 0) return 1;
      if (left.weight > 0 && right.weight > 0 && left.weight !== right.weight)
        return right.weight - left.weight;
      return left.index - right.index;
    })
    .map(({ specification }) => specification);
}

export class FunctionalSequencer extends BaseSequencer {
  override async sort(files: TestSpecification[]): Promise<TestSpecification[]> {
    const sorted = await super.sort(files);
    const functional = await promoteImportedRegistrationSpecs(
      sorted.filter((specification) => specification.project.name === 'functional'),
    );
    let next = 0;
    return sorted.map((specification) =>
      specification.project.name === 'functional'
        ? (functional[next++] ?? specification)
        : specification,
    );
  }
}

function sourcePath(moduleId: string): string {
  const path = moduleId.split('?')[0] ?? moduleId;
  return isAbsolute(path) ? path : resolve(path);
}

function importedFixturePaths(importer: string, source: string): string[][] {
  const parsed = ts.createSourceFile(importer, source, ts.ScriptTarget.Latest, true);
  const paths = new Map<string, string[]>();
  for (const statement of parsed.statements) {
    if (
      !ts.isImportDeclaration(statement) ||
      !ts.isStringLiteral(statement.moduleSpecifier) ||
      !statement.moduleSpecifier.text.startsWith('.')
    )
      continue;
    const base = resolve(dirname(importer), statement.moduleSpecifier.text);
    if (!base.includes('/tests/fixtures/')) continue;
    paths.set(base, sourceCandidates(base));
  }
  return [...paths.values()];
}

function sourceCandidates(path: string): string[] {
  const candidates = path.endsWith('.js')
    ? [path.slice(0, -3) + '.ts', path.slice(0, -3) + '.tsx', path]
    : path.endsWith('.mjs')
      ? [path.slice(0, -4) + '.mts', path]
      : path.endsWith('.cjs')
        ? [path.slice(0, -4) + '.cts', path]
        : [path, `${path}.ts`, `${path}.tsx`];
  return candidates.filter((candidate) => candidate.length > 0);
}

function hasVitestRegistrations(path: string, source: string): boolean {
  const parsed = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true);
  const imported = new Set<string>();
  for (const statement of parsed.statements) {
    if (
      !ts.isImportDeclaration(statement) ||
      !ts.isStringLiteral(statement.moduleSpecifier) ||
      statement.moduleSpecifier.text !== 'vitest' ||
      !statement.importClause?.namedBindings ||
      !ts.isNamedImports(statement.importClause.namedBindings)
    )
      continue;
    for (const element of statement.importClause.namedBindings.elements) {
      const original = element.propertyName?.text ?? element.name.text;
      if (registrationNames.has(original)) imported.add(element.name.text);
    }
  }
  if (imported.size === 0) return false;
  let found = false;
  const visit = (node: ts.Node) => {
    if (found) return;
    if (ts.isCallExpression(node) && registrationRoot(node.expression, imported)) {
      found = true;
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(parsed);
  return found;
}

function registrationRoot(expression: ts.Expression, names: Set<string>): boolean {
  if (ts.isIdentifier(expression)) return names.has(expression.text);
  if (ts.isPropertyAccessExpression(expression))
    return registrationRoot(expression.expression, names);
  return false;
}
