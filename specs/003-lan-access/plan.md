# Implementation Plan: Opt-in local network access

**Feature**: `003-lan-access` | **Date**: 2026-10-31 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `specs/003-lan-access/spec.md`; constitution v3.1.0
(amended for this feature with explicit user approval on 2026-10-31).

## Summary

Add one optional setting, `AI_TASKS_HOST`, naming the IPv4 address the API/UI supervisor
binds. Unset, it is `127.0.0.1` and every current behavior is unchanged. A non-loopback value
turns on local network mode: the CLI validates it before starting the API process (specific
IPv4 literal, owned by a local interface, exact `http://HOST:PORT` browser origin), the
supervisor binds that one address, and the human-readable ready message prints the URL and
the no-authentication warning. Browser Host/Origin/Fetch Metadata checks are reused as is,
with Host/Origin derived from the bound address. No schema, migration, core or UI change.

## Technical Context

**Language/Version**: TypeScript 6.0.3 on Node.js 24.22.0, npm 11.19.1 (pinned, unchanged)
**Primary Dependencies**: Fastify 5, commander 15, Zod 4 (existing); no new dependency
**Storage**: SQLite, unchanged; the network choice is per-process environment only
**Testing**: Vitest functional project (unit + compiled-CLI contracts), existing Playwright
insecure-HTTP browser suites for FR-007 regression
**Target Platform**: Linux host on a trusted private network; phones/desktops as browsers
**Project Type**: Local CLI + HTTP API + mobile web UI (single package)
**Performance Goals**: No change; startup validation is a constant-time interface lookup
**Constraints**: Loopback default (FR-001/FR-009); no wildcard bind (FR-002); no auth (spec
assumption); stdout JSON contract of `serve --json` unchanged
**Scale/Scope**: One new runtime module, three adapter edits, docs and tests

## Constitution Check

*Gate before research and re-checked after design. Both passes: PASS.*

| Principle / rule | Obligation here | Plan | Verification |
| --- | --- | --- | --- |
| I. Thin adapters | No domain logic in transports | Address validation is runtime configuration in `src/runtime/listen-address.ts`; CLI and API entry only call it | Architecture lint (`npm run lint`) |
| II. Isolation & audit | Network writes keep `human-web` actor and atomic audit | No mutation path changes; actor still derived by route | Contract test: LAN mutation produces a `human-web` audit record |
| III. CLI contract | Invalid config → JSON error on stderr, non-zero exit, stdout empty | Validate in `serve` before forking; throw `VALIDATION_ERROR` with fixed messages | Compiled-CLI contract tests for each FR-006 case |
| IV. Mobile/offline | Spec states the offline reopening decision with scenarios (FR-011); writes work on insecure HTTP | Writes: 002 T015, unchanged. Plain HTTP cannot register the service worker (secure context only), so offline reopen is declared unsupported in network mode and stated in the ready message and docs | Existing `board-http-origin`, `browser-uuid-http`; new `board-http-offline` e2e (open tab readable, cold reopen fails, no writes) |
| V. Functions, types, boundaries | Plain functions, explicit dependencies, no `any` | `resolveListenAddress(env, interfaces)` pure function; interfaces injected | Typecheck, lint, unit tests |
| VI. Behavior tests | Proportional, real processes, regression-first N/A | Unit tests for validation; compiled-process test binding a real non-loopback address | Functional suite; see verification matrix |
| VII. Performance/bundle | No regression | No UI change; bundle unchanged | `npm run check:bundle-size` at acceptance |
| Stack: bind rule (v3.1.0) | Loopback default, one explicit specific address, no wildcard, Host/Origin validated before listen, warning | Exactly this design | Unit + contract tests below |
| Compatibility | Public contract changes documented in same change | Update `contracts/cli.md` serve row, `docs/operations.md`, README | Review of diff |
| Privacy | No private data in errors | Error messages are fixed strings plus the operator's own configured address | Unit tests assert messages |

## Project Structure

### Documentation (this feature)

```text
specs/003-lan-access/
├── spec.md
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/serve-network.md
├── checklists/requirements.md
└── tasks.md
```

### Source Code (repository root)

```text
src/runtime/listen-address.ts      # NEW: resolveListenAddress(env, interfaces) → {host, port, origin, network}
src/runtime/supervisor.ts          # listen on options.host instead of literal 127.0.0.1
src/api/main.ts                    # use resolveListenAddress for port/host/origin
src/cli/commands/serve.ts          # validate before fork; LAN ready text + warning
tests/unit/listen-address.test.ts  # NEW
tests/contracts/serve-network.test.ts  # NEW: compiled serve on a real LAN address
docs/operations.md, README.md, specs/001-ai-task-manager/contracts/cli.md
```

**Structure Decision**: Single package, existing layering. `src/runtime` is already imported by
both the CLI and the API entry, so the shared validator lives there.

## Verification matrix

| Spec outcome | Test | Mechanism | Budget |
| --- | --- | --- | --- |
| US2-1, FR-001, FR-009, SC-002, SC-005 | Unit: unset host → `127.0.0.1`, origin default unchanged, custom loopback origin preserved; existing bootstrap serve test unchanged | Vitest functional | default 5s/case |
| US3-1/2/3, FR-002, FR-006, SC-003 | Unit: wildcard `0.0.0.0`, `::`, hostname, malformed, address not on host, origin mismatch (host, port, scheme, path), invalid port | Pure function with injected interfaces | default |
| US3, FR-006, Principle III | Contract: compiled `serve --json` with a foreign address and with mismatched origin exits 1, one `VALIDATION_ERROR` envelope on stderr naming the problem, empty stdout, port not listening | Real CLI process | 10s/case |
| US1-1/2/3, US1-4, US2-2, FR-004/005/007, SC-001, SC-004 | Contract: compiled `serve` (human mode) with the host's first non-internal IPv4 prints the URL and warning; GET via that address 200; connecting to `127.0.0.1:PORT` is refused; valid mutation via LAN origin succeeds and its audit actor is `human-web` | Real process, real socket | 15s |
| US4-1/2, FR-008, SC-004 | Same process: mutation with foreign Origin → 403 `ORIGIN_REJECTED`; request with `Host: 127.0.0.1:PORT` or a different name → rejected; no new audit rows | Real socket, explicit headers | inside the case above |
| FR-007 browser behavior on insecure HTTP | Existing `board-http-origin.spec.ts`, `browser-uuid-http.spec.ts` | Playwright, unchanged | existing budgets |
| US1-5, FR-007 offline tab, FR-011 | `board-http-offline.spec.ts`: plain HTTP origin, no service worker; offline open tab keeps cards and disables writes; offline reopen in a new tab shows no app; no requests mutate and the DB snapshot is unchanged | Playwright, Chromium + WebKit, proxy fails routed requests while offline | 30s/case |
| FR-003, FR-010 | Docs review: README + operations describe the command, choosing an address, stopping, security | Manual review recorded in quickstart | — |

Mutation coverage: success/audit applies (one LAN write). Validation failure and origin
rejection apply at the transport layer. Ownership rejection and rollback are N/A: no domain
mutation changes; existing suites cover them for the same routes. Contention N/A: no lock or
transaction changes. Regression-first N/A: new capability, not a defect.

If the test host has no non-internal IPv4 address, the network contract case is skipped with a
logged reason; it must not be reported as passing. The development host and GitHub runners have one.

## Migration and recovery

None. No schema or stored state. Rollback is unsetting `AI_TASKS_HOST`. The manual `socat`
bridge used before this feature becomes unnecessary; operators should stop it before binding
the same address/port (the validator cannot detect it; `listen` then fails with the existing
startup error).

## Complexity Tracking

No exceptions. The previous constitutional conflict (loopback-only bind) was resolved by the
v3.1.0 amendment rather than an exception.
