# Release validation evidence — T107

T107 is **complete**. Locked installation, native migration/reopen smoke, strict
TypeScript/lint/format checks, production builds and all required execution gates passed:
**1647 functional cases / 122 files** in 173.266s, **26 contention cases / 6 files** in
31.564s, and **168 Chromium/WebKit cases** in 471.845s. The executable quickstart passed
again after the benchmark. Browser JavaScript totals **148542 gzip bytes**, below 150000.

The benchmark completed in 161.857s under its 300s budget. CLI/query/build timing goals
were missed in the measured VMware guest; those goals are separate from acceptance gates.
Earlier failures and their corrective reruns remain recorded below. Final authored-file
formatting is checked by the [release format record](../artifacts/checks/T107-format-release.json)
and [log](../artifacts/logs/T107-format-release.log).

Published [GitHub Actions workflows](ci.md) now execute isolated correctness jobs and manual
benchmarks. The [first hosted findings](ci.md#initial-hosted-findings) record the clean-build
prerequisite and browser hydration/fixture issues exposed by initial runs, with corrections.
The [initial hosted benchmark reports](performance.md#github-hosted-comparison) missed the CLI
goal. After profiling and optimization, [two repeated runs](performance.md#optimization-and-repeated-hosted-measurements)
met all goals: CLI p95 81.440–82.949ms, standard reads 8.109–9.877ms, and full builds
1.238–1.402s. Both final runners used EPYC 9V45; other CPU models remain unmeasured at the
final revision. The T107 results below describe the local release
checks; the [CI run list](https://github.com/mikhailsal/ai-tasks/actions/workflows/ci.yml)
provides the result for each published commit.

## Environment and limits

The [environment record](../artifacts/checks/T107-environment.json) identifies Linux
5.15.0-136-generic x86_64, Node 24.22.0, npm 11.19.1, eight logical CPUs on an Intel
Core i7-4770S @ 3.10GHz, and 16,336,164 kB RAM (about 15.58 GiB). The native runtime
check opened SQLite 3.53.4. The repository and default temporary directory use ext4
on `/dev/sda3`; the saved `lsblk` probe reports `ROTA=1` for the VMware virtual SCSI disk
`sda`. VMware virtualization is confirmed by `systemd-detect-virt`. The operator confirms
physical SSD backing; the earlier physical-HDD inference from the guest flag was incorrect.
The raw measurements remain unchanged, and the disk's contribution was not isolated.
The filesystem was 99% used when initially probed. The required reference profile is four
vCPUs, 8 GiB RAM and local SSD; this VM differs in CPU/memory and virtualization conditions.
Results are not normalized or extrapolated. See the [storage correction](performance.md#actual-environment).

Initial load averages were 14.08/10.43/10.04. Later observations included load around
25–31 and exhausted swap while unrelated installation processes were running. The
[browser host sample](../artifacts/checks/T107-browser-host-load.json) records load
29.38/22.64/14.63, approximately 1.80 GiB available RAM and zero free swap. These
observations do not establish the cause of any particular failure. Foreign processes
were not modified.

Budgets remain unchanged: functional **10s/case, 180s/job**; independent contention
**30s/case, 180s/job**; browser **30s/case, 600s/job**; benchmark **300s/job**. Build
performance has a 5s goal. All emitted browser JavaScript must total **strictly below
150000 bytes**, individually compressed with gzip level 9. Production builds and
processes consuming their output use sequential build leases. No Git hook was bypassed.
See [test commands and evidence rules](../tests/README.md).

## Passed checkpoints

Durations below are outer command durations. These are dated checkpoints; a successful
older static check does not certify subsequent edits. Links retain both records and logs.

| Command / checkpoint                                | Exit | Duration | Evidence                                                                                                                                                                                     |
| --------------------------------------------------- | ---: | -------: | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm ci`                                            |    0 |  40.510s | [record](../artifacts/checks/T107-install.json), [log](../artifacts/logs/T107-install.log)                                                                                                   |
| `npm run check:runtime`                             |    0 |   1.762s | [record](../artifacts/checks/T107-runtime.json), [log](../artifacts/logs/T107-runtime.log)                                                                                                   |
| Migration/reopen smoke, initial                     |    0 |   6.664s | [record](../artifacts/checks/T107-migration.json), [log](../artifacts/logs/T107-migration.log)                                                                                               |
| `npm run typecheck`, initial                        |    0 |  71.069s | [record](../artifacts/checks/T107-typecheck.json), [log](../artifacts/logs/T107-typecheck.log)                                                                                               |
| `npm run lint`, initial                             |    0 | 110.549s | [record](../artifacts/checks/T107-lint.json), [log](../artifacts/logs/T107-lint.log)                                                                                                         |
| `npm run format:check`, initial                     |    0 |  37.938s | [record](../artifacts/checks/T107-format.json), [log](../artifacts/logs/T107-format.log)                                                                                                     |
| `npm run build`, initial                            |    0 |  13.991s | [record](../artifacts/checks/T107-build.json), [log](../artifacts/logs/T107-build.log)                                                                                                       |
| `npm run check:bundle-size`, initial                |    0 |   0.888s | [record](../artifacts/checks/T107-bundle.json), [log](../artifacts/logs/T107-bundle.log)                                                                                                     |
| Executable quickstart, initial                      |    0 |  35.821s | [record](../artifacts/checks/T107-quickstart.json), [log](../artifacts/logs/T107-quickstart.log), [runner](../artifacts/checks/2026-10-22T06-07-40.613Z-functional.json)                     |
| `npm run build`, optimized                          |    0 |   6.156s | [record](../artifacts/checks/T107-build-optimized.json), [log](../artifacts/logs/T107-build-optimized.log)                                                                                   |
| Migration/reopen smoke, optimized                   |    0 |   5.262s | [record](../artifacts/checks/T107-migration-optimized.json), [log](../artifacts/logs/T107-migration-optimized.log)                                                                           |
| Executable quickstart, optimized                    |    0 |  20.612s | [record](../artifacts/checks/T107-quickstart-optimized.json), [log](../artifacts/logs/T107-quickstart-optimized.log), [runner](../artifacts/checks/2026-10-22T06-32-29.384Z-functional.json) |
| `npm run check:bundle-size`, optimized              |    0 |   0.397s | [record](../artifacts/checks/T107-bundle-final.json), [log](../artifacts/logs/T107-bundle-final.log)                                                                                         |
| `npm run typecheck`, post-optimization              |    0 |  35.767s | [record](../artifacts/checks/T107-typecheck-final.json), [log](../artifacts/logs/T107-typecheck-final.log)                                                                                   |
| `npm run lint`, post-optimization                   |    0 |  54.634s | [record](../artifacts/checks/T107-lint-final.json), [log](../artifacts/logs/T107-lint-final.log)                                                                                             |
| Suite cleanup, 3 focused cases                      |    0 |   5.534s | [record](../artifacts/checks/T107-suite-cleanup.json), [log](../artifacts/logs/T107-suite-cleanup.log), [runner](../artifacts/checks/2026-10-22T12-33-14.146Z-functional.json)               |
| `npm run test:contention`, whole suite              |    0 |  43.064s | [record](../artifacts/checks/T107-contention.json), [log](../artifacts/logs/T107-contention.log), [runner](../artifacts/checks/2026-10-22T12-34-07.051Z-contention.json)                     |
| `npm run typecheck`, reconnect source               |    0 | 116.607s | [record](../artifacts/checks/T107-source-checks.json), [log](../artifacts/logs/T107-source-checks.log)                                                                                       |
| `npm run lint`, reconnect source                    |    0 | 210.661s | [record](../artifacts/checks/T107-source-lint.json), [log](../artifacts/logs/T107-source-lint.log)                                                                                           |
| `npm run build`, reconnect                          |    0 |  36.496s | [record](../artifacts/checks/T107-build-reconnect.json), [log](../artifacts/logs/T107-build-reconnect.log)                                                                                   |
| `npm run check:bundle-size`, reconnect              |    0 |   2.155s | [record](../artifacts/checks/T107-bundle-reconnect.json), [log](../artifacts/logs/T107-bundle-reconnect.log)                                                                                 |
| `npm run test:functional`, complete reordered suite |    0 | 173.872s | [record](../artifacts/checks/T107-functional-reordered.json), [log](../artifacts/logs/T107-functional-reordered.log), [runner](../artifacts/checks/2026-10-22T12-55-58.867Z-functional.json) |
| Integrated sequencer, 1 focused case                |    0 |  22.306s | [record](../artifacts/checks/T107-sequencer-integrated.json), [log](../artifacts/logs/T107-sequencer-integrated.log)                                                                         |
| Browser fixes, 16 focused cases, one worker         |    0 | 165.911s | [record](../artifacts/checks/T107-browser-fixed-focused.json), [log](../artifacts/logs/T107-browser-fixed-focused.log), [runner](../artifacts/checks/2026-10-22T12-53-04.158Z-browser.json)  |
| `npm run typecheck`, current source                 |    0 |  44.735s | [record](../artifacts/checks/T107-typecheck-current.json), [log](../artifacts/logs/T107-typecheck-current.log)                                                                               |
| `npm run format`, current checkpoint                |    0 |  23.211s | [record](../artifacts/checks/T107-format-current.json), [log](../artifacts/logs/T107-format-current.log)                                                                                     |
| `npm run format:check`, current checkpoint          |    0 |  35.258s | [record](../artifacts/checks/T107-format-check-current.json), [log](../artifacts/logs/T107-format-check-current.log)                                                                         |
| `npm run test:e2e`, whole final suite               |    0 | 472.131s | [record](../artifacts/checks/T107-browser-final.json), [log](../artifacts/logs/T107-browser-final.log), [runner](../artifacts/checks/2026-10-22T12-59-14.141Z-browser.json)                  |
| `npm run bench`, complete benchmark                 |    0 | 162.322s | [record](../artifacts/checks/T107-benchmark.json), [log](../artifacts/logs/T107-benchmark.log), [runner](../artifacts/checks/2026-10-22T13-07-16.647Z-benchmark.json)                        |
| `npm run test:contention`, post-benchmark           |    0 |  31.825s | [record](../artifacts/checks/T107-contention-current.json), [log](../artifacts/logs/T107-contention-current.log), [runner](../artifacts/checks/2026-10-22T13-10-56.818Z-contention.json)     |
| Executable quickstart, post-benchmark               |    0 |  16.769s | [record](../artifacts/checks/T107-quickstart-current.json), [log](../artifacts/logs/T107-quickstart-current.log), [runner](../artifacts/checks/2026-10-22T13-11-28.525Z-functional.json)     |
| `npm run check:bundle-size`, post-benchmark         |    0 |   0.299s | [record](../artifacts/checks/T107-bundle-current.json), [log](../artifacts/logs/T107-bundle-current.log)                                                                                     |

The dated formatting checkpoints above precede the final documentation edits. The release
format record linked at the top covers the completed documentation.

The migration smoke command is `python3 artifacts/validation/migrate-smoke.py`. It
runs `npm run db:migrate`, reopens through `node dist/migrate.js`, and reads compiled
`meta --all-projects --json` against a disposable database. It confirmed schema version
1, settings revision 1, a UUID epoch and `Europe/Moscow`. Only migration from a
**previous released product version** is N/A: none exists. Populated internal migration
paths and the versioned pagination/completion migrations do exist and have test coverage.

The whole contention run passed **26 cases in 6 files**, runner **42.726s**, on the
actual default ext4 temporary-filesystem profile. The cleanup runner took 5.453s.
The integrated sequencer's focused pass does not constitute a whole functional pass.
The focused browser rerun passed all eight selected regressions in both Chromium and
WebKit (16 cases), runner 163.663s. It verifies epoch review, a cold offline editor on
reconnection, exact lost-response replay, read-error retry, connection messages and deep
links. The subsequent whole browser release run independently passed all 168 cases.

The latest measured browser bundle contains `assets/index-DDSpxw_-.js` at **147757**
gzip bytes and `sw.js` at **785**: **148542 bytes total**, 1458 below the strict limit.
The checker reports Node 24.22.0 and zlib `1.3.2.1-motley-285e94b`, accounts for all
emitted JavaScript against the inventory, and excludes source maps. The latest
[68-file production hash manifest](../artifacts/checks/T107-production-hashes-reconnect.json)
identifies this reconnect build. The [initial manifest](../artifacts/checks/T107-production-hashes.json)
and [optimized checkpoint manifest](../artifacts/checks/T107-production-hashes-final.json)
remain retained; their older browser bundle measured 148457 bytes. All three measured
production builds exceeded the 5s goal; build exit 0 does not mean that goal was met.

## Earlier full functional attempts — all incomplete

Every attempt below exited **124**. Outer durations include command startup and cleanup;
runner durations identify the enforced 180s job boundary. Partial passing counts are
diagnostic progress, never a suite verdict.

| Attempt / command variation                                         |      Outer / runner | Evidence                                                                                                                                                                                 |
| ------------------------------------------------------------------- | ------------------: | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Initial `npm run test:functional`                                   | 181.648s / 180.720s | [record](../artifacts/checks/T107-functional.json), [log](../artifacts/logs/T107-functional.log), [runner](../artifacts/checks/2026-10-22T06-08-38.782Z-functional.json)                 |
| Unchanged warm run                                                  | 181.078s / 180.610s | [record](../artifacts/checks/T107-functional-warm.json), [log](../artifacts/logs/T107-functional-warm.log), [runner](../artifacts/checks/2026-10-22T06-12-49.301Z-functional.json)       |
| Private tmpfs fixture directory                                     | 181.988s / 180.965s | [record](../artifacts/checks/T107-functional-tmpfs.json), [log](../artifacts/logs/T107-functional-tmpfs.log), [runner](../artifacts/checks/2026-10-22T06-18-00.587Z-functional.json)     |
| `--maxWorkers=6 --reporter=verbose`                                 | 190.507s / 180.983s | [record](../artifacts/checks/T107-functional-six.json), [log](../artifacts/logs/T107-functional-six.log), [runner](../artifacts/checks/2026-10-22T06-22-59.093Z-functional.json)         |
| Default four workers after CLI optimization and recovery test split | 180.825s / 180.486s | [record](../artifacts/checks/T107-functional-final.json), [log](../artifacts/logs/T107-functional-final.log), [runner](../artifacts/checks/2026-10-22T06-38-56.488Z-functional.json)     |
| Six-worker progress profile                                         | 182.766s / 180.630s | [record](../artifacts/checks/T107-functional-profile.json), [log](../artifacts/logs/T107-functional-profile.log), [runner](../artifacts/checks/2026-10-22T12-24-12.297Z-functional.json) |

The first log records two individual cases exceeding the unchanged 10s limit:
database initialization at 13.636s and project creation/rollback/replay at 13.725s.
The warm and tmpfs attempts also timed out without completed suite summaries. The
verbose fourth attempt recorded 1153 passing case lines and no failure lines before
termination. The sixth profile completed 114 files and 1567 cases with passing results
before its deadline; the remaining work prevents a passing verdict.

The third attempt used `python3 artifacts/validation/functional-tmpfs.py`, setting only
a private short `TMPDIR` under `/dev/shm` (approximately 7.8 GiB free and 7.7 GiB RAM
available at launch). It retained real file-backed SQLite, WAL/NORMAL, external flock,
source, assertions and deadlines; it did not use `:memory:`. Tmpfs alone did not resolve
the job limit. This filesystem variation is not benchmark calibration: the benchmark
retains its hardcoded `/tmp` path on the observed ext4 device.

The CLI optimization bundles pure JavaScript dependencies while retaining native
SQLite and server dependencies as externals. An isolated interleaved 10+10 CLI sample
measured median startup 347.833→274.584ms ([profile](../artifacts/checks/T107-cli-profile.json));
this is diagnostic evidence, not a completed reference-profile benchmark. Recovery
contracts were mechanically separated into 5 common, 15 HTTP and 15 CLI cases, retaining
all 35 registrations ([registration record](../artifacts/checks/T107-registration-final.json)).

The [file timing profile](../artifacts/checks/T107-file-timings.jsonl) exposed thin
registration entries scheduled near 177s by Vitest's uncached file-size fallback,
with some read-view entries still unqueued. A registration-aware sequencer now preserves
the full inventory and schedules this work explicitly. Functional concurrency is now
`Math.min(6, availableParallelism())`; contention remains one worker. Dead PID entries
were removed from the process watcher; its earlier diagnostic overhead was 14.27 CPU
seconds over 103.31s wall time and 79431 reads. These changes retain assertions and
budgets. Their whole functional verification passed all **1647 cases / 122 files**
in **173.266s**, exit 0, using the default adaptive workers on the actual ext4 host.

## Browser and benchmark gates

The first whole `npm run test:e2e` attempt exited **124**, outer **602.525s**, runner
**601.997s**: [record](../artifacts/checks/T107-browser.json),
[log](../artifacts/logs/T107-browser.log),
[runner](../artifacts/checks/2026-10-22T12-36-29.474Z-browser.json).
It reached 126 cases before termination and contains actual failures, including
WebKit fixture-server startup timeouts. It has no completed passing verdict. Host
pressure is recorded above, without attributing every failure to it. Retained traces
and snapshots are under [the first whole-browser archive](../artifacts/browser/T107-whole-first).
All 16 focused fixes subsequently passed. The final whole rerun passed **168 cases**,
84 in Chromium and 84 in WebKit, exit 0, **472.131s outer / 471.845s runner** within
the unchanged 600s job limit. Its [record](../artifacts/checks/T107-browser-final.json),
[log](../artifacts/logs/T107-browser-final.log) and
[runner](../artifacts/checks/2026-10-22T12-59-14.141Z-browser.json) are separate from the
failed attempt. Passed-run artifacts are archived under
[the whole-browser passed archive](../artifacts/browser/T107-whole-passed).

`npm run bench` completed with exit 0 in **162.322s outer / 161.857s runner**,
within the 300s budget; the report records **161.578s**. The
[full measurement report](../artifacts/benchmarks/2026-10-22T13-07-16.719Z.json)
retains sample arrays, row/materialization facts and environment probes. All **24 workers**
finished without failures: four writers committed 40 mutations and 20 readers completed
20 reads, for 60 measured calls after the readiness barrier.

| Measurement                       |        p95 |            Goal |
| --------------------------------- | ---------: | --------------: |
| 100 cold compiled CLI processes   |  679.494ms |          <100ms |
| Standard materialized task list   |   52.520ms |           <15ms |
| Standard materialized agenda      |   61.180ms |           <15ms |
| Diagnostic materialized task list |  141.975ms | Diagnostic only |
| Diagnostic materialized agenda    |  158.949ms | Diagnostic only |
| Ten complete production builds    | 5735.397ms |         <5000ms |

Build p50 was **3216.979ms**; p95 and maximum were both **5735.397ms**. Successful
benchmark execution does not mean the timing goals were met. The standard CLI/query
thresholds and the full-build goal were missed on the actual eight-logical-CPU,
15.58-GiB VMware guest using ext4 and operator-confirmed physical SSD backing. CPU/memory
and virtualization conditions differ from the four-vCPU, 8-GiB reference. No normalization or reference-profile
performance pass is claimed. See [performance methodology and results](performance.md).

The final output after the benchmark's ten production builds is byte-identical to the tested output:
[the post-benchmark comparison](../artifacts/checks/T107-post-benchmark-identity.json)
compares all **68 files** with the build tested by the functional/browser gates and finds
no changes. The reconnect hash manifest and its **148542-byte** bundle result therefore
remain applicable. The post-benchmark contention rerun passed all **26 cases / 6 files**
in **31.564s runner / 31.825s outer**; the native quickstart rerun passed in
**16.697s runner / 16.769s outer** (driver **16.471s**); bundle accounting passed again
in **0.299s** with the same 148542-byte total.

## Executable quickstart and broader coverage

The quickstart command is
`node scripts/run-suite.mjs functional -- node scripts/validate-quickstart.mjs`.
Its optimized checkpoint passed in 20.612s outer / **20.514s runner** / **20.221s driver**
(initially 35.821s / 35.628s / 35.147s). It checks a real migrated throwaway database,
compiled CLI/file/UTF-8 input, ordinary workflow and exact consent, replay/conflicting
reuse, CLI/HTTP parity, origin rejection, stale revisions, online backup, the validated
restore union, new epoch, retained audit union, DB-free operation-status lookup and
server restart. HTTP job status fences reopening of the verified generation before
normal reads. The driver checks error exit classes and clean API exit 0 without a
termination signal. Its optimized pass predates the newer reconnect UI checkpoint, but
[the server-build identity comparison](../artifacts/checks/T107-server-build-identity.json)
compares all **62 server files** and finds no changes between those builds. The optimized
compiled CLI/HTTP quickstart evidence therefore applies to the current server output;
the final whole browser run verifies the newer UI separately.

This driver alone does **not** execute every manual-guide scenario. Broader coverage
is mapped to the following suites, now covered by the completed functional, contention
and whole-browser gates above. Benchmark timing limitations remain separate:

- Configuration, four priority models, emoji and dependencies: configuration/dependency/
  ordinary-prerequisite integration and contract cases, browser journeys, and the
  independent-process cycle race.
- Recurrence, DST, exact windows, timezones and workers: calendar, occurrence-outcome,
  `recurrence-*`, `timezone-*`, worker, browser and contention cases.
- Offline/mobile and recovery: offline/mobile/recovery/project-draft browser cases,
  restore prepare/stage/crash, recovery boundaries and independent restore contention.
- Remediation: read-view cursor/range tests, prerequisite projection during configuration
  migration, and permanent-reservation union during restore/stage.

See [acceptance coverage](../tests/acceptance-coverage.md) and
[tests/README.md](../tests/README.md), including its retained
[T102 fail/fix history](../tests/README.md#t102-integration-regressions-and-fixture-corrections).
Coverage mappings do not turn unexecuted or timed-out final gates into passes.

## Performance optimization validation

The optimization adds ten agenda filter-intersection cases and two additional timezone cases,
bringing the functional inventory to **1,659 cases**. Existing DST, ordering, pagination,
stale-cursor, indexed-occurrence, input/error, recovery and browser contracts remain in place.
The query-plan collector now explains both SELECT and WITH statements, so materialized
agenda queries retain the existing occurrence-index assertion. No case or suite time budget
was increased.

For the final application/build revision `c8ac95c`, bounded local checks passed **63 cases
across three database/backup/query-plan files**, **42 compiled CLI cases across four files**,
and the executable quickstart (17.090s supervisor). TypeScript, targeted lint, formatting,
production builds and the 148,661-byte browser budget passed. An isolated package-layout
probe also verified identical project-list output when native loading falls back from a
missing prebuild to `build/Release/better_sqlite3.node`. The probe used the same native
binary under the fallback path; it does not claim a separate source compilation.

The full [published CI workflow](https://github.com/mikhailsal/ai-tasks/actions/workflows/ci.yml)
executes the complete functional, contention, quickstart and Chromium/WebKit suites for each
commit. The [measurement extract](benchmarks/2026-10-22-optimization.json) preserves all six
optimization runs, including missed goals, with exact commits and artifact/report hashes.
These newer measurements and test additions do not rewrite the historical T107 local
release results above.

The [complete optimization CI run](https://github.com/mikhailsal/ai-tasks/actions/runs/39844274752)
passed all eight jobs: **1,659 functional cases / 122 files**, **26 contention cases / six
files**, **168 Chromium/WebKit scenarios**, executable quickstart, and quality/build/bundle
checks. Its `9cdab9d` revision has identical application, benchmark, dependency and build
sources to the measured `c8ac95c` revision; the intervening commit records evidence and
adjusts browser package mirror priorities. Subsequent documentation-only corrections do
not change those tested sources.
