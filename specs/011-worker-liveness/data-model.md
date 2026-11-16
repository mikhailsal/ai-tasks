# Data Model: Worker liveness

**Feature**: `011-worker-liveness` | **Date**: 2026-11-16

## Table `worker_passes` (migration `0006_worker_passes.sql`)

| Column | Type | Rule |
|---|---|---|
| `project_slug` | TEXT PRIMARY KEY | references `projects.slug` |
| `last_pass_at` | INTEGER NOT NULL | integer milliseconds |

Written only by the worker; not audited; excluded from `read_revision`; included in backups.

## Worker status (computed)

| Status | Rule |
|---|---|
| `never` | no row for the project |
| `stale` | `now - last_pass_at > 300 s` |
| `healthy` | otherwise, including `last_pass_at` in the future |

Tolerance: 300 s (`WORKER_TOLERANCE_MS`). Write throttle: 60 s.
