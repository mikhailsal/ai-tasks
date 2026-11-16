# Research: Advisory warnings

**Feature**: `010-advisory-warnings` | **Date**: 2026-11-16

Checked against commit `bf8bd62`. Owner decision of 2026-11-16: FR-009 option B.

## R1. Place in the envelope (FR-001, FR-009)

- **Decision**: optional top-level `advisories` array in the success envelope, next to `data`
  and `meta`, plus `advisories_omitted` (integer) when the bound cut the list. Both keys are
  absent when nothing applies, so responses without advisories are byte-identical (US4-1).
  `successEnvelopeSchema` and `mutationSuccessEnvelopeSchema` (`src/schema/envelopes.ts`, strict)
  gain the optional keys; every schema built from them (about 20 files, including the web
  client's shared schemas) accepts them in the same change.
- **Rationale**: `data` shapes differ per command and many are strict; one envelope-level place
  keeps the mechanism uniform. `meta` is about the database read, not about items.
- **Alternatives**: inside `data` (needs a change to every data schema); on stderr only (the
  owner chose B).

## R2. Advisory shape (FR-001, FR-004, FR-008)

- **Decision**: `{code, message, remedy, subject?, count?}`.
  - `code`: lower snake case, registered in the catalogue module
    `src/core/advisories/catalogue.ts` (code → message, remedy hint).
  - `message`: fixed English text from the catalogue, at most 160 characters; no interpolated
    request values (FR-008).
  - `remedy`: 004 Hint shape (`{action, command?, text}`).
  - `subject`: `{type, id}` when the advisory concerns one item; omitted when aggregated.
  - `count`: number of items affected when aggregated (US1-4).
  Order: by catalogue order, then subject id. Bound: 10 per response.

## R3. Computation (FR-002, FR-005, FR-010)

- **Decision**: a provider interface `AdvisoryProvider = (reader, resources) => Advisory[]`.
  Features 011 and 012 register providers. Read handlers call `collectAdvisories` after building
  `data`, with a read-only connection view; mutation handlers call it after the transaction has
  committed, from current state. Stored receipts never contain advisories; a replayed mutation
  gets advisories computed at replay time. Provider failure is caught, logged once, and yields no
  advisory (never a failure, FR-002).
- **Rationale**: conditions are about current state (US2), not about the write.

## R4. Human mode and web (FR-006, FR-007)

- **Decision**: CLI human mode writes `advisory: <code>: <message> (<remedy text>)` lines to
  stderr after the main output; JSON mode carries them in the envelope only. Web: a shared
  `AdvisoryNotice` component renders advisories whose `subject` matches the shown item, and
  aggregated ones at the top of the list.
- **Design details (design review 2026-11-16)**: one notice style (neutral, not error red),
  explanation first, remedy as a second line; at most 2 notices per item, the rest behind «ещё N»;
  when 011 and 012 both apply, the worker notice comes first (catalogue order). Offline, a cached
  advisory is shown with the cached response's time, so a stale-worker notice is not mistaken for
  live state.

## R5. Catalogue and checks (FR-003, SC-002)

- **Decision**: `docs/advisories.md` lists every code. A unit test compares the catalogue
  module's codes with the document's table; an unregistered code cannot be constructed
  (typed union).

## R6. Announcement (FR-009, US4-2/4)

- **Decision**: CHANGELOG entry and `docs/compatibility.md` section "Advisories": what may
  appear, that clients rejecting unknown top-level keys must accept `advisories` and
  `advisories_omitted`, and how to ignore them. Shipped in the same change as the first provider
  (spec assumption).
