# AI Tasks: guide for coding agents

Local task engine: JSON CLI (`node dist/cli.js`), HTTP API, mobile web UI. TypeScript on
Node.js, SQLite, Zod. See `README.md` for setup and `specs/` for contracts.

## Runtime

- Node.js 24.22.0 and npm 11.19.1 are pinned (`package.json` engines, `.nvmrc`).
  Use `nvm use`. `npm run check:runtime` verifies them.
- Never point commands at `data/` or a real database. Use a scratch database:
  `export AI_TASKS_DB_PATH="$(mktemp -d)/db.sqlite"`, `AI_TASKS_BACKUP_DIR` likewise,
  then `npm run db:migrate`.

## Quality limits (enforced by ESLint, `eslint.config.js`)

| Scope                           | Limit                                         |
| ------------------------------- | --------------------------------------------- |
| Source file (`src`, `web/src`)  | 400 lines (nonblank)                          |
| Source function                 | 100 lines (code only)                         |
| Web `.tsx` function             | 150 lines                                     |
| Test file                       | 700 lines                                     |
| Test function                   | 250 lines                                     |
| Complexity / depth / parameters | 12 / 4 / 4 (tests: complexity 20; `.tsx`: 15) |

Split a file or function by responsibility before it reaches a limit. Limits are not
raised and no exception is added without the owner's agreement. Inline lint disables are
forbidden (`noInlineConfig`). No `any`, `@ts-ignore`, or non-null assertions in source.

## Commands

| Command                   | Purpose                                                    |
| ------------------------- | ---------------------------------------------------------- |
| `npm run lint`            | ESLint: limits, layer boundaries, import cycles            |
| `npm run typecheck`       | `tsc` for server, web and service worker                   |
| `npm run format:check`    | Prettier check (`npm run format` writes)                   |
| `npm run test:functional` | Unit, integration and contract tests                       |
| `npm run hooks:install`   | Install the committed pre-push hook (`.githooks/pre-push`) |

The pre-push hook runs the runtime check, typecheck, lint, format check and ShellCheck.
It refuses direct pushes to `main`. CI also runs tests, build and bundle size.

## Architecture

Layers: `src/schema` <- `src/core` <- `src/cli`, `src/api`; `web/src` is separate.
Adapters stay thin: rules live in core. Enforced by `npm run lint`.

## Contracts

Error codes, exit statuses, HTTP statuses and success envelopes are stable. Messages are
for people; programs branch on `error.code`. Documentation changes ship with the behavior
they describe. Agent usage guide: `docs/agent-guide.md`. Changes: `CHANGELOG.md`.
