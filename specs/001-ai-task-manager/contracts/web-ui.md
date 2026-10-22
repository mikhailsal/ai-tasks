# Mobile Web UI contract

Planned interface; all operations use the [HTTP contract](http.md) and shared domain
validation. Every screen occupies one centered column, `width:100%`, `max-width:430px`,
with touch targets at least 44px. There is no alternative multi-column desktop layout.
Long titles, Markdown, JSON-free configuration forms, and audit changes wrap within the
column. Controls have accessible labels, keyboard focus, and non-color status indicators.

## Screens and complete operation coverage

| Screen | Required interactions |
|---|---|
| Project chooser | Active/archived project lists, explicit All projects scope, create project with mandatory selected emoji, name/description/project priority, project details/edit/archive/restore |
| Agenda | Project groups in numeric project-priority order; overdue/today/next seven days/later/no deadline; recurring parent once using earliest unclosed occurrence; filters/search/pagination; task and project emoji visible/copyable |
| Priorities | Project/model context, classic/named levels, Eisenhower quadrants retaining both flags, numeric direction, unset last; no cross-model score |
| Workload | Separate task counts by category/kind and occurrence counts by outcome; archived/terminal filter state visible |
| Task editor/detail | Create ordinary or recurring, title, whole free-form Markdown description, emoji, model-aware optional priority, precise ordinary deadline; configured transitions, configured initial status, archive/restore, audit link |
| Dependencies | List same-/cross-project prerequisites and satisfaction, search/select ordinary task targets, add/remove with explicit source project, explain blockers and cycles without altering either task status |
| Recurring detail | Read/configure timing mode, explicit first deadline, pattern/interval, mandatory window and miss policy; lifecycle controls by configured graph; explicit first-deadline reset when resume requires it; manual process-due action |
| Occurrence history | Outcome, exact deadline, actual and recorded completion times, miss event, saved description/settings snapshot; explicitly select one/many completable records; optional actual completion per row; cancel eligible pending future records with reason |
| Project configuration | Read/apply presets on creation, edit labels/colors/initial status/categories/edges/confirmation, choose all four priority models, preview changes and affected tasks, provide complete old→new mappings, commit atomic migration |
| Audit | Project/aggregate/entity/operation filtering and pagination; actor/origin/time, field-by-field before/after values and original config meanings, user confirmation evidence; no audit export operation |
| Application settings | Shared IANA timezone with explicit project attribution and impact on future calendar generation; existing instants retained |
| Backup/recovery | List/create manual managed snapshots, validate snapshot, show exact current+backup project union, explicit restore confirmation, progress/status through maintenance, new-epoch refresh |

Project pages show slug as immutable reference. Emoji are text, not identifiers or clickable
implicit lookup aliases. On task creation/edit a conflicting meaningful marker stays in the
form with a request for another choice. On reopen/restore offer another marker or explicit
fallback to `⚪`; do not replace a project marker with a default. Archived projects expose
read/history and restore, with other mutations disabled and the reason shown. Archive
blocked by pending recurring records/debts displays those records and the available
pause/complete/cancel actions; it never silently forgives debt.

Paginated views use the response meta.as_of for date buckets/overdue labels until a fresh
first-page refresh; loading more pages never silently reclassifies earlier rows against the
current browser clock. Show that snapshot time separately from last successful refresh time.
Statistics range controls label from as inclusive and to as exclusive, permit an empty equal
range, and explain reversed ranges before submitting.

## Editing and time

Descriptions have an editable Markdown textarea and a preview supplied by the server's
side-effect-free preview route and shared Markdown renderer/sanitizer. Supported CommonMark
content is paragraphs, emphasis, headings, lists, links, and fenced code; images and raw
HTML are disabled. Script, event-handler, and dangerous URL
payloads never execute. Preserve the saved source exactly; no required section templates,
hidden AI fields, or automatic Markdown reformatting. Store the latest successfully fetched
source and rendered HTML for offline viewing. Rendered HTML is display-only and must never
be accepted as replacement Markdown input.

Deadline controls require a date and time, display the current application timezone, and
serialize a precise instant with offset. Date-only submission is unavailable. Ambiguous
local times require an offset choice and nonexistent local times an explicit correction.
The occurrence display distinguishes deadline, confirmation boundary, actual completion,
and recording time. A past deadline is allowed and visibly classified by the shared clock
rules. Users can clear an ordinary deadline or priority; they cannot clear project priority.

Transition controls are derived from the current configuration; only allowed targets are
offered. The confirmation dialog names the exact task and source/target states, captures
explicit confirmation text, and submits `asserted:true` with that text. Confirmation is
specific to this transition and is not authentication or blanket approval for later edits.
Dependency blockers remain enforced after confirmation. A direct recurring restore uses the
same dialog and submits confirmation in TaskRestore when its configured archived-to-paused
edge requires it. Ordinary restore has no transition-confirmation field; project restoration
keeps its explicit administrative exception for child transitions.

All edits carry epoch, entity revision, and project config revision from their source view.
A conflict keeps the proposed input, shows the current server state alongside it in a
vertically stacked comparison, and requires the user to revise/retry. Re-reading never
silently replaces a dirty editor or silently changes its base revision. A changed project
configuration reloads the controls while preserving proposed text and asks the user to
reconcile affected status/priority choices. A lost response retries the same immutable
operation ID and body before deciding a write failed; a changed proposal gets a new ID.

## Offline contract

After the first successful online load, a versioned service worker caches the application
shell for reload/reopening. IndexedDB persists the latest successfully fetched query
snapshots and loaded description source/HTML, keyed by database epoch, scope, filters,
configuration revision, and query shape. Offline support does not promise data never fetched
or persistence after the browser clears site storage. Service worker navigation fallback
serves the shell; API requests are not fabricated as successful fresh network responses.

When offline, show a persistent offline indicator and last successful refresh time. Cached
lists/details are readable; uncached routes explain the missing cache instead of displaying
a current-looking empty list. All mutation controls, including saves, transitions, config,
backup/restore, and manual ticks, are disabled. There is no offline command queue. Unsaved
text remains locally available as a draft, separate from the last server snapshot.

On reconnect, refresh metadata/config/query snapshots while retaining dirty draft text and
its original base revision. Reconcile new database epochs before permitting a save; old
cache/drafts are not submitted against a restored database automatically. Connectivity
flapping cannot enqueue or duplicate commands. During restore maintenance, show the job's
progress from its maintenance-safe endpoint; once successful, refresh epoch and all loaded
state, preserving drafts for explicit review.

## Browser acceptance obligations

Use browser tests at narrow and wide viewports to check the centered 430px column, 44px
targets, keyboard use, wrapping, and every command family above. Verify cross-project
grouping and model-aware inputs, confirmation text in audit, dependency blockers, recurrence
debt selection, migration rollback, exact-time controls, and description/emoji conflicts.
Load a description online, disconnect, reload/reopen, verify shell and cached source/HTML,
open an uncached detail, attempt disabled writes, reconnect with a competing CLI edit, and
prove the draft survives and its stale save conflicts. Exercise both missing and stale
cache, reconnect flapping, lost-response replay, restore maintenance/new epoch, and hostile
Markdown. These are required future checks, not claims of implemented behavior.

Restore validation displays typed error.details.conflicts from EMOJI_CONFLICT in server order.
This includes conflicts involving markers assigned after the selected backup. A restore never releases such a marker or silently
rewrites task/project emoji; conflicting staged data prevents publication. Existing drafts
and the current database remain intact on rejection.
