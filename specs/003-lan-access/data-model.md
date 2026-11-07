# Data Model: Opt-in local network access

No persistent data changes: no tables, columns, migrations or stored settings.

## Listen address (process configuration)

Resolved once per start from the environment and local interfaces.

| Field | Source | Rule |
| --- | --- | --- |
| `host` | `AI_TASKS_HOST`, default `127.0.0.1` | IPv4 dotted literal; not `0.0.0.0`; non-loopback must belong to a local interface |
| `port` | `AI_TASKS_PORT`, default `3000` | Integer 1–65535 (existing rule) |
| `origin` | `AI_TASKS_ORIGIN`, default `http://HOST:PORT` | Loopback: any exact origin (existing). Network: must equal `http://HOST:PORT` |
| `network` | derived | `true` when `host` is outside `127.0.0.0/8` |

Expected Host header is `new URL(origin).host`, as before.
