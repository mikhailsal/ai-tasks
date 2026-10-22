import { readFileSync, statSync } from 'node:fs';
import { builtinModules } from 'node:module';
import path from 'node:path';
import ts from 'typescript';

const serverPackages =
  /^(?:better-sqlite3|drizzle-orm|@js-temporal\/polyfill|marked|sanitize-html|emoji-regex|fastify|@fastify\/[^/]+|commander)(?:\/|$)/u;
const databasePackages = /^(?:better-sqlite3|drizzle-orm|node:sqlite|sqlite3)(?:\/|$)/u;
const builtins = new Set(builtinModules.map((name) => name.replace(/^node:/u, '')));
const nodeHost = ts.sys;
const resolutionCache = ts.createModuleResolutionCache(process.cwd(), (filename) => filename, {
  moduleResolution: ts.ModuleResolutionKind.Bundler,
  allowJs: true,
});
const parsedFiles = new Map();

function fileContent(filename) {
  const stat = statSync(filename, { bigint: true });
  const cached = parsedFiles.get(filename);
  if (cached && cached.mtimeNs === stat.mtimeNs && cached.size === stat.size) return cached;
  if (cached) resolutionCache.clear();
  const content = readFileSync(filename, 'utf8');
  const entry = { content, mtimeNs: stat.mtimeNs, size: stat.size };
  parsedFiles.set(filename, entry);
  return entry;
}

function sourceFile(filename) {
  const entry = fileContent(filename);
  if (!entry.source) {
    entry.source = ts.createSourceFile(filename, entry.content, ts.ScriptTarget.Latest, true);
  }
  return entry.source;
}

function preprocessedFile(filename) {
  const entry = fileContent(filename);
  if (!entry.preprocessed) entry.preprocessed = ts.preProcessFile(entry.content, true, true);
  return entry.preprocessed;
}

function isServerImport(name) {
  return name.startsWith('node:') || builtins.has(name) || serverPackages.test(name);
}

function resolveImport(name, filename) {
  return ts.resolveModuleName(
    name,
    filename,
    {
      moduleResolution: ts.ModuleResolutionKind.Bundler,
      allowJs: true,
    },
    nodeHost,
    // Re-resolve authored paths so a newly created/deleted local file cannot hide an edge.
    name.startsWith('.') || path.isAbsolute(name) ? undefined : resolutionCache,
  ).resolvedModule?.resolvedFileName;
}

// Follow runtime schema re-exports too: a browser-safe barrel must not hide SQLite or
// another server dependency. Type-only declarations do not bring code into a bundle.
function browserViolation(name, filename, visited = new Set()) {
  if (isServerImport(name)) return name;
  const resolved = resolveImport(name, filename);
  if (!resolved || resolved.includes('/node_modules/') || visited.has(resolved)) return;
  if (/\/src\/(?:core|cli|api|runtime)\//u.test(resolved)) return resolved;
  visited.add(resolved);
  const source = sourceFile(resolved);
  let violation;
  function visit(node) {
    if (violation) return;
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) {
      const clause = ts.isImportDeclaration(node) ? node.importClause : node;
      if (clause?.isTypeOnly) return;
      const bindings = ts.isImportDeclaration(node) ? clause?.namedBindings : node.exportClause;
      if (
        bindings &&
        'elements' in bindings &&
        bindings.elements.length > 0 &&
        bindings.elements.every((element) => element.isTypeOnly)
      )
        return;
      if (node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
        violation = browserViolation(node.moduleSpecifier.text, resolved, visited);
      }
    } else if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
      const argument = node.arguments[0];
      if (argument && ts.isStringLiteral(argument))
        violation = browserViolation(argument.text, resolved, visited);
    }
    ts.forEachChild(node, visit);
  }
  visit(source);
  return violation;
}

function isTypeOnly(node) {
  return (
    node.importKind === 'type' ||
    node.exportKind === 'type' ||
    (node.specifiers?.length > 0 &&
      node.specifiers.every(
        (specifier) => specifier.importKind === 'type' || specifier.exportKind === 'type',
      ))
  );
}

function isDatabaseReceiver(node) {
  if (node.type === 'Identifier')
    return /^(?:db|database|sqlite|sql|connection|statement|stmt)$/iu.test(node.name);
  if (node.type !== 'MemberExpression') return false;
  const name = node.computed ? node.property.value : node.property.name;
  return (
    typeof name === 'string' &&
    /^(?:db|database|sqlite|sql|connection|statement|stmt)$/iu.test(name)
  );
}

function containsSql(node) {
  const text =
    node.type === 'Literal'
      ? node.value
      : node.type === 'TemplateLiteral'
        ? node.quasis[0]?.value.cooked
        : undefined;
  return (
    typeof text === 'string' &&
    /^\s*(?:SELECT\s|INSERT\s+INTO\s|UPDATE\s+\S+\s+SET\s|DELETE\s+FROM\s|CREATE\s+TABLE\s|ALTER\s+TABLE\s|PRAGMA\s)/iu.test(
      text,
    )
  );
}

const rule = {
  meta: {
    type: 'problem',
    schema: [],
    docs: {
      description: 'Keep application code functional, SQL in core, and browser imports safe.',
    },
    messages: {
      class:
        'Use plain functions. Authored classes are allowed only for custom errors extending Error or a local custom error.',
      database:
        'Database access belongs in src/core/; adapters and runtime only validate or orchestrate.',
      browser:
        'Browser runtime dependency reaches server-only code: {{dependency}}. Use a browser-safe schema module or a type-only import.',
      dynamic:
        'Use a literal module specifier so architecture and browser boundaries can be verified.',
    },
  },
  create(context) {
    const filename = path.resolve(context.filename).replaceAll('\\', '/');
    const browser = filename.includes('/web/src/');
    const adapter = /\/src\/(?:cli|api|runtime)\//u.test(filename);
    const localErrors = new Set([
      'Error',
      'TypeError',
      'RangeError',
      'SyntaxError',
      'ReferenceError',
      'URIError',
      'EvalError',
      'AggregateError',
    ]);

    function checkImport(node, source) {
      if (typeof source?.value !== 'string') {
        context.report({ node, messageId: 'dynamic' });
        return;
      }
      if (isTypeOnly(node)) return;
      if (adapter && databasePackages.test(source.value))
        context.report({ node, messageId: 'database' });
      if (browser) {
        const violation = browserViolation(source.value, filename);
        if (violation)
          context.report({ node, messageId: 'browser', data: { dependency: violation } });
      }
    }

    function checkClass(node) {
      const parent = node.superClass;
      if (parent?.type === 'Identifier' && localErrors.has(parent.name)) {
        if (node.id) localErrors.add(node.id.name);
        return;
      }
      context.report({ node, messageId: 'class' });
    }

    return {
      ClassDeclaration: checkClass,
      ClassExpression: checkClass,
      ImportDeclaration(node) {
        checkImport(node, node.source);
      },
      ExportNamedDeclaration(node) {
        if (node.source) checkImport(node, node.source);
      },
      ExportAllDeclaration(node) {
        checkImport(node, node.source);
      },
      ImportExpression(node) {
        checkImport(node, node.source);
      },
      CallExpression(node) {
        if (node.callee.type === 'Identifier' && node.callee.name === 'require')
          checkImport(node, node.arguments[0]);
        if (!adapter) return;
        if (node.arguments.some(containsSql)) {
          context.report({ node, messageId: 'database' });
          return;
        }
        const callee = node.callee;
        const member =
          callee.type === 'MemberExpression' &&
          (callee.computed ? callee.property.value : callee.property.name);
        // SQL/Drizzle vocabulary is deliberately reserved in transport/runtime modules.
        if (
          [
            'prepare',
            'pragma',
            'select',
            'selectDistinct',
            'insert',
            'update',
            'delete',
            'transaction',
            'execute',
            'run',
            'all',
            'get',
          ].includes(member) &&
          isDatabaseReceiver(callee.object)
        ) {
          context.report({ node, messageId: 'database' });
        }
      },
      TaggedTemplateExpression(node) {
        if (
          adapter &&
          ((node.tag.type === 'Identifier' && node.tag.name === 'sql') ||
            (node.tag.type === 'MemberExpression' &&
              node.tag.object.type === 'Identifier' &&
              node.tag.object.name === 'sql'))
        ) {
          context.report({ node, messageId: 'database' });
        }
      },
    };
  },
};

function reachesFile(name, filename, target, visited = new Set()) {
  const resolved = resolveImport(name, filename);
  if (!resolved || resolved.includes('/node_modules/')) return false;
  if (resolved === target) return true;
  if (visited.has(resolved)) return false;
  visited.add(resolved);
  const source = preprocessedFile(resolved);
  return source.importedFiles.some((dependency) =>
    reachesFile(dependency.fileName, resolved, target, visited),
  );
}

// import-x intentionally ignores type-only edges. The architectural dependency graph
// includes them, so check local imports independently as well as runtime cycles.
const cycleRule = {
  meta: {
    type: 'problem',
    schema: [],
    messages: {
      cycle: 'Local module dependency cycle through {{dependency}} (including type imports).',
    },
  },
  create(context) {
    function check(node) {
      if (typeof node.source?.value !== 'string') return;
      const filename = path.resolve(context.filename);
      if (reachesFile(node.source.value, filename, filename)) {
        context.report({ node, messageId: 'cycle', data: { dependency: node.source.value } });
      }
    }
    return {
      ImportDeclaration: check,
      ExportNamedDeclaration: check,
      ExportAllDeclaration: check,
      ImportExpression: check,
    };
  },
};

export default { rules: { 'functions-and-boundaries': rule, 'no-local-cycle': cycleRule } };
