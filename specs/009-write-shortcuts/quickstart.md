# Quickstart validation: Write shortcuts

**Feature**: `009-write-shortcuts` | **Date**: 2026-11-16

Scratch database only.

1. **Done in one call (US1-1, SC-001)**: daily task with icon 🛏; `occurrence done 🛏 --project
   demo --day 2026-11-15 --json` succeeds with no prior read.
2. **Repeat (US3-1, SC-004)**: same command again → `data.existing: true`; audit count unchanged.
3. **Different data (US3-2)**: same day with another `--at` → refused, stored record shown.
4. **Ambiguity (US1-3/4, SC-002)**: day without occurrence → nearest days; hourly task with
   several on the day → candidates; repeat with `--occurrence` → success.
5. **Move (US2)**: `task move <id> --to in_progress`; disallowed target → allowed list; `--from`
   mismatch → actual status.
6. **Audit parity (US3-3, SC-003)**: integration test compares audit events of shortcut and
   strict writes on twin fixtures (`npm run test:functional`).
7. **Race**: two processes run `occurrence done` for the same day; exactly one writes, the other
   returns `existing: true`.
