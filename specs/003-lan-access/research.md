# Research: Opt-in local network access

## R1 — How the owner selects network mode

- **Decision**: Environment variable `AI_TASKS_HOST` (IPv4 literal), consistent with
  `AI_TASKS_PORT`/`AI_TASKS_ORIGIN`. Command: `AI_TASKS_HOST=192.168.1.10 npm start`.
- **Rationale**: Every listener setting is already an environment variable shared by the
  CLI and the API child; no new CLI flag surface or parsing.
- **Alternatives**: `serve --host` flag (a second way to set the same thing, and the CLI
  contract explicitly excluded an arbitrary listen-host option); a separate `start:lan`
  script that auto-detects the address (violates FR-002: no implicit network choice).

## R2 — Where validation runs

- **Decision**: In the `serve` CLI process before forking the API child, and again in the
  API entry as defense in depth.
- **Rationale**: `serveApi` deliberately replaces child error messages with a fixed
  "API process failed" text. Validating in the CLI yields the specific explanation
  FR-006 requires without loosening that rule.

## R3 — Validation rules

- **Decision**: Accept a dotted-quad IPv4 literal. `127.0.0.0/8` is loopback mode (current
  behavior, origin unrestricted as today). Anything else is network mode and must (a) not be
  `0.0.0.0`, (b) be an address of a local interface from `os.networkInterfaces()`, (c) have
  `AI_TASKS_ORIGIN` unset or exactly `http://HOST:PORT`. Hostnames, IPv6 and `::` are rejected.
- **Rationale**: Exact Host checks require a stable literal; names and IPv6 bracket forms
  add ambiguity with no current need. Checking interfaces up front avoids an opaque
  `EADDRNOTAVAIL` from the child.
- **Alternatives**: Allow `https:` origin (no TLS in scope); allow hostnames (out of scope).

## R4 — Readiness output

- **Decision**: Human mode prints `Web interface on the local network: http://HOST:PORT/` and
  a warning line. `--json` mode keeps exactly one metadata envelope on stdout and nothing on
  stderr; the warning is part of the human start command and documentation.
- **Rationale**: Principle III forbids diagnostic noise in JSON mode; assistants use the CLI,
  not network serving. `npm start` uses human mode.

## R5 — Insecure HTTP browser support

- **Decision**: Writes need no change: feature 002 (T015) already made operation IDs work
  without a secure context. Offline reopening is declared unsupported in network mode.
- **Rationale**: Browsers register service workers only in secure contexts (HTTPS or
  localhost), so plain `http://LAN-IP` cannot cache the shell; data persisted for the open tab
  still works. Found by PR #1 review after the first validation tested writes only.
- **Alternatives**: HTTPS with a locally trusted CA installed on each phone (deferred with
  TLS; self-signed certificates are rejected for service workers); Chrome's
  `unsafely-treat-insecure-origin-as-secure` flag (Android Chrome only, per device, documented
  as an optional owner workaround, not a supported path); dropping `no-store` for static assets
  (would allow HTTP-cache reopens only by accident and conflicts with the cache policy).
