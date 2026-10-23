# Local HTTP API v1

Planned base URL: `http://127.0.0.1:3000/api/v1`. The same Fastify process serves the built
mobile UI. Vite development uses `http://127.0.0.1:5173` and proxies `/api` to Fastify; the
development origin policy is explicit and enabled only in development. External automation
uses the CLI in this release. JSON resource, payload, revision, audit, and error shapes are
defined in [common.md](common.md).

## Browser request boundary

The server binds only `127.0.0.1`. Validate Host against the configured exact host and port,
including read requests, to reject DNS rebinding. Browser API requests are same-origin;
mutations require an exact allowed `Origin`, `Content-Type: application/json`, and
`X-AI-Tasks-Mutation: 1`. No wildcard CORS, reflected origins, or cross-origin credentials.
Dev proxy requests preserve the exact configured dev-origin check; production does not
silently inherit a dev allowlist. Origin/header/content checks run before opening a write
transaction. A rejected request receives `ORIGIN_REJECTED` and creates no audit entry.
Responses contain `Cache-Control: no-store`; offline application snapshots are managed by
the UI, not stale HTTP cache responses. Content security policy excludes unsafe inline
script execution; Markdown rendering excludes raw HTML.

There is no authentication, login, account, or caller-controlled actor field. Accepted
browser commands use actor `human-web`. Workflow confirmation remains required where
configured. Automation cannot claim to be human by supplying an actor property.

Mutation body:

```json
{
  "operation_id": "UUID",
  "database_epoch": "UUID",
  "expected_revision": 4,
  "expected_config_revision": 2,
  "payload": {"title": "Revised title"}
}
```

Preconditions absent by definition (for example a newly created task's revision) are omitted,
not guessed or supplied as zero. Revision headers/ETags are not an alternative contract.
Route project slug is explicit command scope. Read requests accept either `project_slug`
or `all_projects=true` when the route is not already project scoped. Repeated conflicting
scope fields fail validation. Complex read queries use the JSON POST query routes below;
they are side-effect-free and require the same origin/custom-header boundary but no mutation
envelope. Simple collection GETs accept URL-encoded common filter/query parameters; the
priority value is a JSON-encoded query value, not a cross-model rank. Paginated domain reads
and statistics expose meta.as_of separately from meta.now; cursors retain the server-selected
as_of across pages, with no accepted caller clock override. Statistics from/to follow the
shared half-open [from,to) convention, including equal/reversed/null-timestamp cases.

## Complete route table

Prefix all routes below with `/api/v1`. `P` means `/projects/:project_slug`, `T` means
`/projects/:project_slug/tasks/:task_id`. `M` marks mutation envelopes. GET and query POST
routes are side-effect-free. List routes use the common pagination envelope. Every route
returns JSON, including errors; API-not-found errors do not return the SPA shell.
`O` marks backup/restore operational commands with envelopes/manifest receipts rather than
the ordinary domain mutation transaction. Every POST/PATCH/PUT, including read-only query
POSTs and operational actions, still requires the browser request boundary.

| Method | Route | Input / result |
|---|---|---|
| GET | `/meta` | Explicit `all_projects=true`; epoch, timezone, settings revision, API/schema versions, maintenance status |
| GET | `/projects` | Explicit scope/filter query → Project list |
| POST M | `/projects/:project_slug` | ProjectCreate → Project, `201` |
| GET | `P` | Project |
| PATCH M | `P` | ProjectPatch → Project |
| POST M | `P/archive` | `{affected_tasks:[{task_id,expected_revision}]}` → Project |
| POST M | `P/restore` | `{affected_tasks:[{task_id,expected_revision}]}` → Project |
| GET | `/config/presets` | Explicit read scope → default priority/workflow presets |
| GET | `P/config` | ProjectConfig |
| POST | `P/config/preview` | `{config,status_mappings,priority_mappings,affected_tasks}` → affected tasks/revisions and mapping issues |
| POST M | `P/config/migrate` | ConfigMigration → config and affected task revisions |
| GET | `/tasks` | Explicit scope/common filters → Task summaries |
| POST M | `P/tasks` | TaskCreate → Task detail, `201` |
| GET | `T` | Task detail |
| PATCH M | `T` | TaskPatch → Task detail |
| POST M | `T/transitions` | TaskTransition → Task detail |
| POST M | `T/archive` | Empty payload or required recurring confirmation → Task detail |
| POST M | `T/restore` | TaskRestore, including configured recurring `confirmation` → Task detail |
| POST | `P/description/preview` | `{description}` → `{rendered_html}`; no saved mutation |
| GET | `T/dependencies` | Dependency list |
| POST M | `T/dependencies` | Dependency identifiers → updated parent and links, `201` |
| POST M | `T/dependencies/remove` | Dependency identifiers → updated parent and links |
| GET | `T/recurrence` | Recurrence settings and summary |
| PUT M | `T/recurrence` | RecurrenceInput → settings and updated parent revision |
| POST M | `T/recurrence/control` | `{to_status_id,confirmation?,first_deadline?}` → lifecycle result |
| POST M | `P/recurrence/tick` | `{tasks:[{task_id,expected_revision}]}` → generated/expired IDs, affected revisions |
| GET | `T/occurrences` | `state` filter/pagination → Occurrence list |
| GET | `T/occurrences/:occurrence_id` | Occurrence detail with immutable snapshots |
| POST M | `T/occurrences/complete` | `{occurrences:[{id,expected_revision,actual_completed_at?}]}` → selected rows and parent revision |
| POST M | `T/occurrences/cancel` | `{occurrences:[{id,expected_revision}],reason}` → selected rows and parent revision |
| GET | `/agenda` | Explicit scope/common filters → project-first agenda groups |
| GET | `/priorities` | Explicit scope/common filters → project/priority groups |
| GET | `/stats` | Explicit scope/common filters → separate task/occurrence counters |
| GET | `/audit` | Explicit scope, `entity_id?`, `operation_id?`, pagination → before/after Audit list |
| GET | `/settings` | Explicit scope → Settings |
| PATCH M | `P/application-settings` | `{timezone}`; expected settings revision → Settings |
| GET | `/backups` | `all_projects=true` → Backup list |
| POST O | `P/backups` | Empty payload; expected settings revision → Backup, `201`; domain DB read-only |
| POST | `/backups/:backup_id/validate` | `{all_projects:true}` → integrity/compatibility and affected-project union; conflicts return structured EMOJI_CONFLICT per common contract |
| POST O | `P/backups/restore` | `{backup_id,affected_projects,confirmation}`; expected settings revision → maintenance job receipt, `202` |
| GET | `/backups/jobs/:job_id` | `all_projects=true` → restore status/receipt, available during maintenance |
| GET | `/backups/jobs` | `all_projects=true&operation_id=UUID` → same status/receipt if initial job response was lost |

All successful mutations are `200` unless listed as `201`/`202`; exact replay in the current
epoch returns the original envelope and status. Validated request bodies are at most 1 MiB
except backup transfer; oversized requests return structured `VALIDATION_ERROR` rather than
an HTML proxy error. Domain cardinality and size validation runs before committing any part
of a request.

Restore status data is `{job_id,state:"queued"|"running"|"succeeded"|"failed",started_at,finished_at,result:null|RestoreResult,error:null|Error}`.
RestoreResult includes `database_epoch`, affected project slugs, immutable restore audit IDs,
and the recovery snapshot ID. The maintenance helper closes/drains DB connections and takes
the exclusive external lock; status is read from the job manifest without a DB connection.
All other state endpoints return `MAINTENANCE` while replacement is in progress. A lost
response is recovered by querying its receipt using job ID or original operation ID. A
successful restore changes epoch, so replaying its old-epoch command is rejected.

## Example: description conflict

After reading task revision `7` and config revision `3`, the UI submits:

```json
{"operation_id":"UUID","database_epoch":"UUID","expected_revision":7,"expected_config_revision":3,"payload":{"description":"## Plan\nKeep the existing context and add the next step."}}
```

If a CLI edit has committed revision `8`, respond HTTP `409` with `REVISION_CONFLICT`,
including the expected/current revisions. Do not write the task or audit. The UI keeps its
draft and fetches the current detail for a manual revised retry. It cannot simply change the
expected revision and silently re-submit old text.

## Required validation

Use Fastify injection against a real migrated SQLite fixture for every route family,
including scope mismatch, missing/invalid revision, configuration races, idempotency,
confirmation, rollback, and stable error status. Test Host/Origin/content-type/custom-header
rejection separately from domain validation. Use actual browser tests for the Vite proxy,
production same-origin UI, history fallback versus API 404, sanitized Markdown, and restore
maintenance/status flow. CLI and HTTP equivalence is asserted at observable resource/audit
behavior; actor/origin are the intentional transport differences.

## Settings and child-state preconditions

Schedule-dependent writes carry `expected_settings_revision` in the JSON mutation envelope,
with CONFIG_CONFLICT when the shared timezone/settings changed. Project archive/restore
payloads include `affected_tasks:[{task_id,expected_revision}]` for every affected child;
child lifecycle or revision failure rejects the entire operation. Project restoration pauses
formerly active recurring children but preserves draft and individually archived children.

## Additive mobile board contracts (002)

Task, agenda and priority list reads additionally accept mutually exclusive `deadline_preset` and exact local `deadline_day` filters. Task summaries may include a derived `blocked` boolean; task details retain their required field. Existing no-filter behavior and ordinary task ordering are unchanged. `GET /api/v1/projects/:project_slug/board` reads a configured column with shared ordering/revision, and `POST /api/v1/projects/:project_slug/tasks/:task_id/position` reorders or performs a guarded atomic transfer. See the full [board read/write and deadline contract](../../002-mobile-ux/contracts/board-api.md).
