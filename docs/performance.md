# Performance profile

The complete local `npm run bench` run on 2026-10-22 exited **0** in **161.857s** under the separate
300s supervisor budget (162.322s outer command; 161.578s harness). See the
[raw report](../artifacts/benchmarks/2026-10-22T13-07-16.719Z.json), [command record](../artifacts/checks/T107-benchmark.json),
[log](../artifacts/logs/T107-benchmark.log), and
[bounded runner record](../artifacts/checks/2026-10-22T13-07-16.647Z-benchmark.json).

## Actual environment

Linux 5.15.0-136-generic x64; Node 24.22.0, npm 11.19.1, native SQLite 3.53.4. The host
has eight logical CPUs on an Intel Core i7-4770S @ 3.10GHz and 15.58 GiB RAM. The benchmark
recorded 7,616,921,600 free RAM bytes at startup. Temporary databases use ext4 on `/dev/sda3`
(97% used at this probe). The guest reports `ROTA=1` for a VMware virtual SCSI disk;
`systemd-detect-virt` confirms VMware. This guest flag does not establish the physical
backing device type. The operator confirms that the physical host uses SSD storage.

The reference profile is Linux, four vCPUs, 8 GiB RAM and local SSD. This VM exposes eight
logical CPUs and 15.58 GiB RAM, so CPU/memory and virtualization conditions differ from the
reference. Results describe this run without normalization, extrapolation or a claim of
reference-hardware calibration. The initial report incorrectly inferred physical HDD
storage from `ROTA=1`; that conclusion is withdrawn. The measured timings remain unchanged,
and disk-specific latency was not isolated. Other host activity can affect measurements.

VMware documents that a virtual disk can appear rotational despite SSD backing. Its
`scsiX:Y.virtualSSD` parameter controls the advertised device type; see the
[VMware Linux guest SSD guidance](https://knowledge.broadcom.com/external/article/328830/how-to-emulate-an-ssd-virtual-disk-on-a.html).
Raw benchmark/environment artifacts retain their original guest observations.

## Workloads and method

Both isolated file databases use production migrations, real WAL/SQLite connections and
shared lifetime locks. Foreign-key checks found zero violations and integrity checks returned
`ok`. The deterministic standard dataset has 20 projects, 1,000 tasks, 10,000 occurrences and
50,000 audit records; the diagnostic dataset has 20 projects, 10,000 tasks, 100,000 occurrences
and 50,000 audit records. Fixture schema and representative query coverage are also exercised
by the functional suite.

Cold samples run 100 fresh compiled CLI processes using `project list --all-projects --json`,
including process startup, database open, complete output and process exit. Filesystem caches
are not flushed. Warm queries use one connection per profile, 10 warmups per query, then 500
samples per standard query and 50 per diagnostic query. Each page requests all projects with
limit 200 and returns exactly 200 materialized rows. Timing includes production query work,
JSON serialization and consumer JSON parsing; it excludes opening the warm connection.

The injected query clock is `2027-01-15T08:00:00.000Z`. Standard task-list/agenda output sizes
are 81,614/90,563 bytes; diagnostic output sizes are 84,122/90,261 bytes. Both profiles preserve
`read_revision=1` and have `total_changes_delta=0`. Percentiles use nearest rank, with no
outlier removal. Build samples run ten complete `npm run build` invocations, including both
server and browser production output.

## Measured latency

All entries are milliseconds.

| Workload                        | Samples |      p50 |      p95 |  Maximum |
| ------------------------------- | ------: | -------: | -------: | -------: |
| Cold CLI, process start to exit |     100 |  379.020 |  679.494 |  854.633 |
| Standard task list              |     500 |   35.929 |   52.520 |   74.325 |
| Standard agenda                 |     500 |   41.445 |   61.180 |   76.570 |
| Diagnostic task list            |      50 |  102.024 |  141.975 |  170.027 |
| Diagnostic agenda               |      50 |  136.513 |  158.949 |  163.334 |
| Full server + browser build     |      10 | 3216.979 | 5735.397 | 5735.397 |

The cold CLI p95 goal is **below 100ms**; standard materialized reads target **below 15ms**.
This run missed both. The complete-build median was 3.217s, while p95/maximum was 5.735s,
exceeding the documented 5s full-build goal. Diagnostic queries are a separate larger-data
measurement, not a substitute for the standard profile. These goals are not acceptance gates;
exit 0 records successful workload execution and does not mean the latency goals were met.

## Independent process contention

All 24 workers acknowledged readiness before a shared `go` barrier. Four writers each
performed ten real compiled CLI project creations; twenty independent readers each performed
one real compiled CLI task-list call. All 40 mutations and 20 reads succeeded, with zero worker
failures and clean exits. The measured phase lasted **7.665s**, excluding readiness metadata
calls. The report retains each setup and measured call.

| Calls under contention | Samples |      p50 |      p95 |  Maximum |
| ---------------------- | ------: | -------: | -------: | -------: |
| Writer                 |      40 |  529.876 | 2703.924 | 2951.397 |
| Reader                 |      20 | 2636.547 | 2863.314 | 2867.455 |

These contention latencies include competing process startup and are separate from the
uncontended CLI goal. Correctness races and bounded lock exhaustion are covered by the
independent-process contention suite described in [validation](validation.md).

The benchmark ran with exclusive ownership of production output after browser and helper
processes stopped. The final build after all ten samples matches the exact **68-file** tested output manifest;
[the post-benchmark comparison](../artifacts/checks/T107-post-benchmark-identity.json) reports
zero changed files. Re-run `npm run bench` on the declared SSD reference host before making
reference-profile latency claims.

The seed, full build, materialization and process harness sources are
[benchmark.mjs](../scripts/benchmark.mjs), [benchmark-query.ts](../scripts/benchmark-query.ts),
[benchmark-process-worker.mjs](../scripts/benchmark-process-worker.mjs), and
[benchmark-data.ts](../tests/fixtures/benchmark-data.ts).

## GitHub-hosted comparison

Two isolated manual runs on 2026-10-22 succeeded: [run 1](https://github.com/mikhailsal/ai-tasks/actions/runs/39805292957)
and [run 2](https://github.com/mikhailsal/ai-tasks/actions/runs/39805564273). Their application,
lockfile and benchmark sources are identical; the second commit only corrects the functional
CI build prerequisite. Each fresh `ubuntu-24.04` VM exposed four vCPUs and approximately
15.61 GiB RAM, with Node 24.22.0, npm 11.19.1 and SQLite 3.53.4. Run 1 received an Intel
Xeon Platinum 8573C; run 2 received an AMD EPYC 9V45. These are not the 8 GiB reference profile.

All entries below are **p95 milliseconds**, with unchanged workloads and nearest-rank
percentiles. The [committed measurement extract](benchmarks/2026-10-22-github.json) retains
p50, p95, maximum, sample counts, environment, commit IDs and artifact/report SHA-256 hashes.
Full sample reports, runner metadata and logs are attached to each run for fourteen days.

| Workload                      | Local VMware | GitHub Intel | GitHub AMD | Goal       |
| ----------------------------- | -----------: | -----------: | ---------: | ---------- |
| Cold CLI, 100 samples         |      679.494 |      188.574 |    136.684 | <100ms     |
| Standard list, 500 samples    |       52.520 |       19.805 |     12.037 | <15ms      |
| Standard agenda, 500 samples  |       61.180 |       23.004 |     14.104 | <15ms      |
| Diagnostic list, 50 samples   |      141.975 |       53.012 |     33.439 | Diagnostic |
| Diagnostic agenda, 50 samples |      158.949 |       79.636 |     55.510 | Diagnostic |
| Full build, 10 samples        |     5735.397 |     1615.284 |   1154.768 | <5000ms    |

The bounded benchmark commands completed in 80.290s and 53.368s, within 300s. Each
independent-process phase completed all 60 calls across 24 ready workers with zero failures
(5.199s and 3.604s). Both final browser bundles passed at 148,542 gzip bytes, matching the
local emitted assets and remaining below the 150,000-byte budget.

Both hosted runs improved on the local timings. Full builds met their goal in both runs;
standard queries met theirs on AMD only; cold CLI missed its goal in both. The CPU profiles
and timing differences demonstrate that the shared runner label does not guarantee identical
performance. Two runs do not establish long-term stability or isolate local overload as the
cause of the earlier misses. Use these measurements as initial evidence, retain environment
metadata on future runs, and compare like hardware before treating a change as a regression.
