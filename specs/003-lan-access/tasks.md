# Tasks: Opt-in local network access

**Input**: [plan.md](plan.md), [spec.md](spec.md), [contracts/serve-network.md](contracts/serve-network.md)

Quality gates already exist (typecheck, ESLint size/complexity rules, Prettier, architecture
lint, CI, hooks); no setup phase is needed.

## Phase 1: Validation core (US2, US3 — P1/P2)

- [x] T001 [US2][US3] Write `tests/unit/listen-address.test.ts` first: default loopback, custom loopback origin preserved, valid network address with default and explicit origin, and every FR-006 rejection from the contract table with exact messages (FR-001/002/006/009; SC-002/003).
- [x] T002 [US2][US3] Implement `resolveListenAddress(env, interfaces)` in `src/runtime/listen-address.ts` as a pure function returning `{host, port, origin, network}`; make T001 pass.

## Phase 2: Wiring (US1, US3)

- [x] T003 [US1] `src/runtime/supervisor.ts`: accept `host` in options and listen on it instead of the literal `127.0.0.1`.
- [x] T004 [US1] `src/api/main.ts`: derive port/host/origin from `resolveListenAddress` with `os.networkInterfaces()`.
- [x] T005 [US1][US3] `src/cli/commands/serve.ts`: resolve before `serveApi` so failures surface as specific `VALIDATION_ERROR` envelopes; print the network URL and warning in human mode; keep JSON and loopback text unchanged (FR-004/005/006).

## Phase 3: Process-level verification (US1, US3, US4)

- [x] T006 [US3] `tests/contracts/serve-network.test.ts`: compiled `serve --json` with a foreign address and with a mismatched origin → exit 2, empty stdout, one envelope with the contract message, nothing listening (SC-003).
- [x] T007 [US1][US2][US4] Same file: compiled human-mode `serve` on the first non-internal IPv4 → printed URL and warning; GET 200 via LAN; loopback refused; valid LAN mutation succeeds with `human-web` audit; foreign Origin and loopback/alternate Host rejected without audit change. Skip with a logged reason only when no such address exists (SC-001/002/004).

## Phase 4: Documentation (FR-003, FR-010)

- [x] T008 Update `docs/operations.md` settings table and startup section, README start/limits sections, and the `serve` row in `specs/001-ai-task-manager/contracts/cli.md`.

## Phase 5: Acceptance

- [x] T009 Run typecheck, lint, format check, functional suite, build and bundle check; run the existing insecure-HTTP browser specs (`board-http-origin`, `browser-uuid-http`) for FR-007. Record commands, exits and durations in quickstart.md.
- [x] T010 Replace the manual socat bridge on the owner's host with the new mode and verify the real URL responds.

## Phase 6: PR #1 review follow-up (FR-007, FR-011)

Codex review found that plain HTTP cannot register the service worker, so offline reopening
does not work on other devices; the first validation tested writes only. Owner chose to
narrow the feature rather than add TLS.

- [x] T011 [US1] `tests/e2e/board-http-offline.spec.ts` with the shared `tests/fixtures/insecure-origin.ts` proxy: plain HTTP origin, no service worker, offline open tab keeps cards and disables writes, offline reopen shows no app, no writes or DB change (Chromium + WebKit).
- [x] T012 [US1] Spec US1-5/FR-007/FR-011, plan, research R5, contract, ready message and docs state that offline reopening is unsupported over plain HTTP; document the Android Chrome flag as an unsupported workaround.

## Dependencies

T001 → T002 → T003–T005 → T006–T007 → T009. T008 is independent after T002. T010 last.

## Traceability

FR-001 T001/T007 · FR-002 T001/T002 · FR-003 T008 · FR-004 T005/T007 · FR-005 T005/T007 ·
FR-006 T001/T005/T006 · FR-007 T007/T009 · FR-008 T007 · FR-009 T001/T009 · FR-010 T008 · FR-011 T011/T012.
Constitution v3.1.0 bind rule: T002/T005/T006/T007. Principle III: T006. Principle VI: T001/T006/T007.
