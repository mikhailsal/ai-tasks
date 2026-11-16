# Contract: human wording of `completed_late`

**Feature**: `006-late-recording-label` | **Date**: 2026-11-16

| Place | Today | After |
|---|---|---|
| Web state label (rows, filters, counts, legends) | Выполнено поздно | Записано после окна |
| CLI human summary line | поздние N | записаны после окна N |
| JSON state value | `completed_late` | `completed_late` (unchanged) |

Meaning, for documentation: the completion was recorded after the occurrence's confirmation
window. The actual completion time is stored separately and the label says nothing about it.
Actual completion time and recording time stay visible wherever they are shown today.
