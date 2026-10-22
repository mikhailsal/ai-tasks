# Analysis remediation — 2026-10-21

Scope: the seven findings from the post-task specification analysis. The user approved
remediation; this update changes English planning artifacts only, not application code.
The constitution is unchanged. Existing task IDs and the 107-task backlog are preserved.

| Finding | Resolution | Implementation and verification owners |
|---|---|---|
| C1 — Bundle threshold | Require total individually gzipped emitted browser JavaScript strictly below 150,000 bytes; equality fails. Plan, constitution and task gate agree. | T103, T107 |
| I1 — Restore confirmation | TaskRestore accepts confirmation; a configured confirmation-required recurring restore edge requires assertion and user text, audited atomically. Ordinary restore rejects this inapplicable field; project restoration keeps its administrative child-transition exception. | T061, T067, T068, T077 |
| I2 — Permanent marker retention | Restore unions live and backup permanent project-emoji reservations with original slug owners, retaining owners absent from restored projects without a live-project FK. Equal key/owner keeps the live row; divergent owners or staged marker collisions fail before publication. Validation and helper failures expose typed, deterministically ordered ReservationConflict details in EMOJI_CONFLICT. No marker/history rewrite or reservation release. | T006, T009, T089, T094, T095, T100 |
| A1 — Time-stable pagination | Server selects as_of on the first page, binds it in the cursor and reuses it for all page classifications. Return meta.as_of separately from request-time meta.now; reject caller clock overrides. A fresh first page captures new time; data changes still invalidate read_revision. | T052, T078, T079, T085 |
| A2 — Migration dependency scope | Check prerequisite satisfaction in the projected final state for ordinary tasks whose status ID/category changes into in_progress/review/completed. Unchanged advanced dependents remain in place when prerequisites leave completed, including across projects. Label/color/edge/priority-only edits do not trigger this transition guard; structural invariants still apply. | T036, T042, T047 |
| A3 — Statistics range boundaries | Use [from,to): omitted bounds unbounded, equal bounds empty, reversed bounds invalid. Exclude a null filtering timestamp only when at least one bound exists. Statistics capture one server as_of per request. | T079, T082, T086 |
| I3 — Setup execution gate | Setup authors harness scaffolding and checks toolchain/native availability. Run migrated database and compiled application checks at T021 after T014–T020; missing executables/imports are not passing or valid failing behavior-test evidence. | T004, T014, T018–T021 |

The normative rules are synchronized in [spec.md](../spec.md), [plan.md](../plan.md),
[data-model.md](../data-model.md), [common](../contracts/common.md),
[CLI](../contracts/cli.md), [HTTP](../contracts/http.md), and
[mobile UI](../contracts/web-ui.md) contracts. [tasks.md](../tasks.md) assigns concrete
implementation and test owners; [quickstart.md](../quickstart.md) includes the new
acceptance cases. The restore decision in [research.md](../research.md) also includes
permanent reservation retention.

## Verification scope

- Rechecked the seven findings across the revised artifacts, including independent read-only
  reviews of domain semantics and architecture. No unresolved contradiction remains within
  those seven remediation items.
- Structural validation checks sequential unique task IDs, story labels, explicit dependency
  references/order, disjoint parallel write paths, all 26 FR / 13 SC / 11 VT references,
  local links, fenced JSON syntax, balanced fences and trailing whitespace.
- All 107 tasks remain unchecked; requirement-to-task coverage remains 39/39 buildable
  requirements. Task presence is not evidence of implemented or tested application behavior.
- Application tests, native builds, browser checks and benchmarks were not run: this is a
  documentation-only change before application implementation. Their required tasks remain
  in the backlog. No Git hooks were bypassed and no deployment or commit was performed.

Next step: implement the backlog starting with Setup and Foundation, retaining the corrected
T021 execution gate and the regression cases above.
