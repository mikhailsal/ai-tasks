# Compatibility and upgrades

## Current baseline

The application contract and persisted application schema report version **1**. The package
version is **0.1.0**. This repository has no released predecessor: a released-version upgrade
matrix and predecessor rollback result are **not applicable**, not presumed passing.
Internal populated-schema migration tests are useful evidence, but they are not a substitute
for testing upgrades from an actual shipped release.

The supported deployment is Linux with local filesystem storage, `flock`, Node.js **24.22.0**,
npm **11.19.1**, and the pinned lockfile. `better-sqlite3` is native; the loaded SQLite must be
**3.51.3 or newer**. Run `npm ci` and `npm run check:runtime` on the target host. Browser code
requires a current Chromium/WebKit-class browser with IndexedDB, service workers, and modern
JavaScript string/Unicode support. The automated browser matrix is Chromium and WebKit; it is
not a claim of support for every browser/version, private-mode quota, or storage policy.

Ship matching application code, `dist/`, `web/dist/`, `drizzle/`, package metadata, and native
dependencies. Server bundles require all configured production helper entries; a standalone
CLI JavaScript file copied without its companion chunks/helpers is not a deployment. Build
checks enforce the browser/server boundary and count every emitted browser JS asset, including
the service worker, against a total strictly below 150,000 gzip bytes.

## Data and interface compatibility

Managed snapshots are checked for checksum, integrity, compatible schema, readable audit,
and reservation consistency before use. Passing SQLite integrity alone is insufficient.
An incompatible backup is refused instead of partially loaded. Restore is database-wide,
creates a new epoch, and preserves historical audit/reservation ownership as specified in
[the recovery contract](../specs/001-ai-task-manager/contracts/common.md).

Entity/config/settings revisions and epochs are public concurrency tokens. Preserve the exact
wire body on an uncertain retry, including original strings and operation ID; a client must
not silently rebase or infer a fresh revision. CLI inputs are flat, HTTP mutation bodies have
a `payload` object, and read scopes are explicit. JSON response/error semantics, archived
controls, workflow categories, priority meanings, timestamp precision, and recurrence snapshots
are compatibility obligations, not merely UI implementation details.

The service worker shell and IndexedDB query cache are versioned separately from drafts.
A new epoch invalidates query/cursor identity; cached reads must not become fresh responses.
Drafts preserve original fields, timezone interpretation, base tokens, and uncertain request
identity until explicit reconciliation. Upgrades must not auto-send persisted mutations.
Browser cache persistence remains best-effort and is not a durable database migration path.

## Obligations before a future upgrade

1. Identify the actual released versions, contract changes, schema changes, renderer changes,
   and supported native/runtime combinations. Keep migration assets immutable once shipped.
2. Create verified managed backups and preserve external manifests before changing application
   files. Record the live epoch and deployed version. Quiesce API, worker, and standalone
   recovery owners before upgrading; do not rebuild bundles beneath live compiled helpers.
3. Test forward migration on a populated copy from every supported predecessor, with ordinary
   and recurring tasks, all priority/workflow models, descriptions, audit/receipts, permanent
   reservations, generations, intervals, occurrences, and completion facts. Verify row identity,
   foreign keys/checks, captured semantic history, and query purity. Never rely only on a fresh DB.
4. Exercise staged restore/recovery and crash boundaries using real shared/exclusive locks.
   Refuse corrupt/unreadable history and incompatible snapshots without changing live data.
   Distinguish failed, indeterminate, and successful operational outcomes through durable status.
5. Test the supported old/new client/server combinations. A breaking wire-contract change needs
   an explicit version/transition policy; do not silently reinterpret stored configuration,
   recurrence time, confirmation, priority values, or old client requests.
6. Validate production/browser builds, bundle size, native smoke, functional/contention/browser
   suites, and benchmark methodology. Record actual commands, versions, exit codes, durations,
   and any failures. An implementation checkpoint does not establish final release acceptance.
7. Prove a rollback path on a populated copy. Binary rollback is allowed only when that binary
   can read the resulting schema, data, and operational records. Otherwise use the documented
   compatible recovery procedure and a verified snapshot; account for history/reservation union
   and new epochs. Do not invent a down-migration, copy a live SQLite file, or erase WAL/phase
   evidence to force an older executable to start.

The final T107 release/upgrade checkpoint must record those applicable results. This document
states the current baseline and future obligations; it does not claim T107 has already passed.
