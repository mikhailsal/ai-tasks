# GitHub Actions

The workflows are published in the public `mikhailsal/ai-tasks` repository and have executed
on GitHub-hosted runners. Follow the [CI runs](https://github.com/mikhailsal/ai-tasks/actions/workflows/ci.yml)
for the result associated with each commit. Manual [benchmark runs](https://github.com/mikhailsal/ai-tasks/actions/workflows/benchmark.yml)
and their [measured comparison](performance.md#github-hosted-comparison) are recorded separately
from correctness checks.

Local workflow validation passed actionlint 1.7.12, ShellCheck for every shell step, and
Prettier. Actual test collection confirms functional shards of 747 and 900 cases across
61 files each, and browser shards of 44 and 40 cases per engine. The combined inventories
contain all 1,647 functional and 168 browser cases without missing or overlapping cases;
see the [collection record](../artifacts/checks/CI-workflow-validation.json). Collection
does not execute the tests or substitute for hosted execution.

## Correctness checks

[CI](../.github/workflows/ci.yml) runs on pull requests, pushes to `main`, and manual dispatch.
Each job receives its own `ubuntu-24.04` VM and installs the exact Node version from `.nvmrc`
and npm version from `package.json`. It uses `npm ci`, checks native SQLite/flock behavior,
and caches npm downloads. Native `node_modules` and production output are built afresh.

| Job                                      | Work                                                                                                     | Existing inner budget     |
| ---------------------------------------- | -------------------------------------------------------------------------------------------------------- | ------------------------- |
| Quality                                  | Workflow lint, TypeScript, lint, formatting, migrated DB/reopen, full build, exact browser JS accounting | Normal command completion |
| Functional 1/2 and 2/2                   | All unit, integration and compiled CLI/HTTP contracts, split by Vitest                                   | 10s/case, 180s/shard      |
| Quickstart, on functional shard 1        | Disposable database, real CLI/HTTP, consent, replay and restore                                          | 180s                      |
| Contention                               | Independent processes, actual SQLite and filesystem locks                                                | 30s/case, 180s/job        |
| Chromium 1/2 and 2/2; WebKit 1/2 and 2/2 | All production mobile/offline/recovery browser scenarios, one Playwright worker per VM                   | 30s/case, 600s/shard      |

Sharding distributes every test across separate machines. It preserves assertions,
per-case deadlines, production assets and test isolation. The functional collection and
browser test inventories are checked locally to ensure the shards cover the complete suites
without overlap. The existing full-suite local commands remain available unchanged.
GitHub job timeouts of 15–20 minutes also cover installation, builds and evidence upload;
they do not extend the bounded test commands. Each VM sequences its builds and consumers,
so a browser server or compiled helper never overlaps a rebuild of its production files.

The eight correctness jobs can run independently. An updated PR cancels its older CI run;
failure of one matrix shard does not cancel its siblings. Required status checks can be
selected in repository branch protection after their first hosted run exists.

## Measurements

[Benchmarks](../.github/workflows/benchmark.yml) is a separate manual workflow. In GitHub,
open **Actions → Benchmarks → Run workflow** and choose the revision to measure. It builds
once, then runs the existing `npm run bench` under its unchanged 300s budget. The benchmark
owns that VM and all production output while executing its ten full builds, cold CLI
samples, warm materialized queries and independent-process workload. The final emitted
browser JavaScript is checked again after the benchmark.

The optional **profile** input captures eight separate cold CLI CPU profiles after the
normal measurements. Profiled invocations do not contribute to benchmark samples; raw
profiles and a frame-cost summary are uploaded with that run's benchmark evidence.

Performance goals remain diagnostic rather than required PR checks. A hosted runner avoids
competition with this workstation's processes, but CPU models, image revisions, virtualization
and service load can vary. Compare repeated runs on the same runner profile and retain the
reported p50/p95/maximum plus environment data. A single faster or slower result is not proof
of a code regression or of disk-specific behavior. The published runner has 16 GB RAM, so
it differs from the original 8 GiB reference profile; measurements must disclose that.

## Evidence and access

Jobs upload bounded-runner JSON records, logs and runner environment information even when
a test fails. Browser artifacts include retained failure traces, screenshots and videos.
Correctness artifacts are retained for seven days; benchmark reports for fourteen days.
`runner.txt` records the commit, image version, CPU, memory, filesystem and guest disk flags.
A guest `ROTA` flag alone does not identify the physical backing storage.

The workflows request only `contents: read`, use `pull_request`, and disable persisted
checkout credentials. They require no repository secrets. Remote actions are pinned to
verified commit SHAs with release comments; the workflow linter archive is checksum-pinned.

For public repositories, standard GitHub-hosted runners have free, unlimited execution
minutes. The documented public Linux profile provides four vCPUs, 16 GB RAM and 14 GB SSD
storage. Larger runners are billed even for public repositories. Concurrency and execution
limits still apply; the current Free plan permits twenty concurrent standard jobs, which
exceeds this workflow's eight-job fan-out. Artifact/cache storage and retention should be
managed separately from execution minutes.

Sources checked when preparing these workflows:

- [GitHub-hosted runner profiles](https://docs.github.com/en/actions/reference/runners/github-hosted-runners)
- [Actions limits](https://docs.github.com/en/actions/reference/limits)
- [Actions billing](https://docs.github.com/en/billing/concepts/product-billing/github-actions)
- [Playwright CI guidance](https://playwright.dev/docs/ci)

Existing local release results and performance limitations remain in
[validation](validation.md) and [performance](performance.md).

## Initial hosted findings

The [initial CI run](https://github.com/mikhailsal/ai-tasks/actions/runs/39805167936)
exposed a missing build prerequisite: three functional shell contracts require browser output,
so both functional jobs now run the complete production build before tests. A clean checkout
made that dependency visible. The [next run](https://github.com/mikhailsal/ai-tasks/actions/runs/39805537347)
passed all 1,647 functional cases, the quickstart, 26 contention cases and quality checks, then
exposed browser failures:

- After reload, a pristine settings editor could retain old persisted-query values even though
  a fresh server response contained the new timezone. Pristine drafts now follow new source
  snapshots; dirty/restored proposals keep their original fields and revision guards. The
  saved message follows refresh completion.
- Successful browser scenarios could hang in cleanup while browser clients were still
  connected to a custom server. Tests close the complete browser context before the server,
  including its service worker, extra tabs and shared API request connection pool.
- Chromium's request event omitted a replay body in the offline test while the retained
  network trace showed two identical successful PATCH requests. That test now observes the
  exact fetch body across replacement documents and additionally checks the replay response
  against the original receipt. Real transport and database assertions remain in place.

These corrections preserve the suite assertions and all existing case/job time budgets.
The latest CI run verifies the complete suites after these changes; earlier failed runs and
retained traces remain linked above.

## Performance follow-up

The [complete optimization record](performance.md#optimization-and-repeated-hosted-measurements)
retains all six subsequent measurement runs. Both final runs met the unchanged CLI, standard
query and full-build goals on EPYC 9V45 runners. Performance remains diagnostic; successful
execution alone does not indicate that a goal was met.

The [intermediate CI run](https://github.com/mikhailsal/ai-tasks/actions/runs/39841138446)
exposed a query-plan test collector that only explained SELECT statements. It now includes
WITH statements and again verifies the occurrence index inside the materialized agenda
query. The existing index assertion was retained.

Browser installation also encountered repeated slow package downloads from
`azure.archive.ubuntu.com`, before application tests started. Browser jobs now prefer
`https://archive.ubuntu.com/ubuntu/` in the runner's existing APT mirror list, retaining Azure
and security archives as fallbacks. This reverses the first two priorities in the
[upstream runner-image configuration](https://github.com/actions/runner-images/blob/main/images/ubuntu/scripts/build/configure-apt-sources.sh).
The selected browser, system dependencies, package signature verification and all test/job
budgets remain unchanged. This download issue is separate from the performance measurements;
the benchmark workflow does not install browsers or change APT mirrors.
