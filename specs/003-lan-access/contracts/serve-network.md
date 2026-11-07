# Contract: `serve` listen address

Amends the `serve` row of [001 CLI contract](../../001-ai-task-manager/contracts/cli.md) and
the settings table in `docs/operations.md`.

## Settings

| Variable | Default | Meaning |
| --- | --- | --- |
| `AI_TASKS_HOST` | `127.0.0.1` | IPv4 address to bind. Non-loopback enables local network mode |
| `AI_TASKS_PORT` | `3000` | unchanged |
| `AI_TASKS_ORIGIN` | `http://HOST:PORT` | Loopback: unchanged. Network mode: must equal `http://HOST:PORT` |

Origins use the canonical URL form: when `PORT` is `80`, omit `:80`. For example,
`AI_TASKS_HOST=192.168.1.10 AI_TASKS_PORT=80` derives `http://192.168.1.10`;
an explicit `AI_TASKS_ORIGIN` must use that same form. Host headers and printed URLs
also omit the default port.

## Startup failures (before any listener)

Exit code 2 (the CLI code for every `VALIDATION_ERROR`); stdout empty; stderr one error envelope with `code: "VALIDATION_ERROR"`,
`retryable: false`, `details: null` and one of these messages:

| Condition | Message |
| --- | --- |
| Not an IPv4 literal (hostname, IPv6, malformed) | `AI_TASKS_HOST must be an IPv4 address` |
| `0.0.0.0` | `AI_TASKS_HOST must be one specific address, not all networks` |
| Not assigned to this computer | `AI_TASKS_HOST is not an address of this computer` |
| Network mode origin ≠ `http://HOST:PORT` | `AI_TASKS_ORIGIN must equal http://HOST:PORT in local network mode` |
| Invalid port | `Invalid local API port` (existing) |

## Readiness

- `--json`: unchanged, one metadata envelope on stdout.
- Human mode, loopback: unchanged text `API is ready on the configured loopback port`.
- Human mode, network:

```text
Web interface on the local network: http://HOST:PORT/
Warning: every device on this network can read and change all data without signing in.
Offline reopening is unavailable over plain HTTP; an open tab keeps showing loaded data.
```

## HTTP

Unchanged rules applied to the network origin: Host must equal `HOST:PORT`; mutations need
Origin `http://HOST:PORT`, JSON content type and `X-AI-Tasks-Mutation: 1`. The loopback
address is not listening in network mode.
