# GitHub Actions

The workflows target the public `mikhailsal/ai-tasks` repository. They are prepared locally;
the first hosted execution and its results become available after the workflows and the
application sources are pushed to GitHub. Local validation is recorded separately from a
successful hosted run.

Local workflow validation passed actionlint 1.7.12, ShellCheck for every shell step, and
Prettier. Actual test collection confirms functional shards of 747 and 900 cases across
61 files each, and browser shards of 44 and 40 cases per engine. The combined inventories
contain all 1,647 functional and 168 browser cases without missing or overlapping cases;
see the [collection record](../artifacts/checks/CI-workflow-validation.json). Collection
does not execute the tests or substitute for the first hosted run.

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
