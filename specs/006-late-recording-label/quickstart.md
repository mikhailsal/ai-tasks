# Quickstart validation: Late-recording label

**Feature**: `006-late-recording-label` | **Date**: 2026-11-16

On a scratch database (`AI_TASKS_DB_PATH` under a temporary directory, `npm run db:migrate`):

1. Create an active daily recurring task whose first deadline is in the past, so one occurrence
   is owed; complete it with `actual_completed_at` inside its window.
2. `stats --project demo` (human mode): the summary says «записаны после окна 1».
3. `occurrence list <task> --project demo --json`: the state is `completed_late` and both times
   are present, exactly as before (compare with the previous build).
4. Web: open the task's occurrences; the row, filter and count read «Записано после окна»; the
   details still show both times (`npm run test:e2e -- read-views`).
5. Search: no «Выполнено поздно» or «поздние» in `web/src`, `src`, `docs`, `README.md` (unit
   search test in `npm run test:functional`).
