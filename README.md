# AI Tasks

A local task engine with a JSON CLI, an HTTP API, and a Russian mobile web interface.
Projects define their own priority model and ordinary/recurring workflows. The interfaces
share revision guards, idempotency, audit history, recurrence rules, and manual recovery.
There are no accounts or login screen: access to the local service is access to its data.

## Install and start

Use Linux, a local filesystem, Node.js **24.22.0**, npm **11.19.1**, and the `flock` utility.
The Node/npm pins are enforced; `better-sqlite3` is a native dependency. If using nvm, run
`nvm install` and `nvm use` in the directory containing `package.json`, then install the
pinned npm version if needed: `npm install --global npm@11.19.1`.

From that package directory:

```bash
npm ci
npm run check:runtime
export AI_TASKS_DB_PATH="$PWD/data/ai-tasks.sqlite"
export AI_TASKS_BACKUP_DIR="$PWD/data/backups"
npm run db:migrate
npm run build
npm start
```

Open **http://127.0.0.1:3000**. Migration is explicit; queries and server startup do not
initialize or migrate a new database. Keep the same environment variables for the server
and CLI. `npm run dev` starts the API watcher and Vite at **http://127.0.0.1:5173**, with
`/api` proxied to the API on port 3000. Test offline shell behavior against a production
build; the development server does not provide the production service worker.

The API supervisor starts recurring workers for active projects. Workers process due work
at startup, continue bounded catch-up batches, and check again every 30 seconds. Reads do
not tick recurrence or silently change task state.

## CLI and contracts

Use the compiled entry directly; a global installation is unnecessary:

```bash
node dist/cli.js help --json
node dist/cli.js meta --all-projects --json
node dist/cli.js project list --all-projects --json
node dist/cli.js task list --project demo --json
node dist/cli.js agenda --all-projects --json
node dist/cli.js priorities --all-projects --json
node dist/cli.js stats --project demo --json
```

Commands shown with `--project demo` require an existing project named `demo`.
See the [quickstart](specs/001-ai-task-manager/quickstart.md) for creation examples.

Every application read needs an explicit scope: `--project SLUG` or `--all-projects`, as
supported by its command. Writes require `--project`; backup list/validate/status require
`--all-projects`. The two scope flags are mutually exclusive. A CLI mutation input is a
**flat JSON object** containing operation/epoch/revision tokens and command fields.
HTTP mutations use `{operation_id,database_epoch,expected_...?,payload:{...}}` and bind
project scope from the route. Do not pass the HTTP `payload` wrapper to the CLI.

Use `--input file.json` or `--input -` with piped UTF-8 JSON, at most 1 MiB. Duplicate
flag/body fields are rejected even when equal. Every new mutation uses a fresh UUID;
an uncertain result is retried only with its original actor, scope, target, operation ID,
and body. Refresh revisions before a changed proposal. JSON mode writes one success
envelope to stdout, or one error envelope to stderr with a nonzero exit. JSON help/version
are informational exceptions without database metadata.

- [Shared payloads, guards, and errors](specs/001-ai-task-manager/contracts/common.md)
- [CLI commands](specs/001-ai-task-manager/contracts/cli.md)
- [HTTP methods, scopes, and routes](specs/001-ai-task-manager/contracts/http.md)
- [Web interaction contract](specs/001-ai-task-manager/contracts/web-ui.md)
- [Operations and recovery](docs/operations.md)
- [Compatibility and future upgrades](docs/compatibility.md)

## Operational limits

Keep the database, WAL/SHM, stable lock files, and managed recovery directory on local
storage. SQLite uses WAL with `synchronous=NORMAL`: this is not a promise of zero committed
transaction loss after sudden power or OS failure. Use managed manual backups; copying only
an open `.sqlite` file is not a consistent backup.

The default listener is loopback-only. Exact Host/Origin, Fetch Metadata, JSON, and mutation
header checks reduce cross-origin browser attacks; **they are not authentication**. Local
programs can make requests directly. Do not expose the service to untrusted users or turn
it into a public endpoint by changing an origin setting.

After a successful online load, the built UI can reopen cached pages offline. Browser
storage is best-effort and has no application-imposed expiry; eviction, quota, or clearing
site data can remove it. Unfetched pages are explicitly unavailable. Every write is disabled
offline or during reconciliation/maintenance; there is no offline command queue. Drafts
and uncertain operation proposals are separate from cached server snapshots. Reconnect or
restore preserves original draft text/base and requires explicit review before a changed save.

## Checks

```bash
npm run typecheck
npm run lint
npm run format:check
npm run test:functional
npm run test:contention
npm run test:e2e
npm run build
npm run check:bundle-size
npm run bench
```

Run build-dependent suites sequentially: builds replace `dist/`, and live compiled helpers
must finish before it is rebuilt. Browser JavaScript, including the service worker and lazy
chunks, must total **less than 150,000 gzip bytes**. See [release validation](docs/validation.md)
for recorded results and any remaining gates.
