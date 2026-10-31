# Quickstart: Opt-in local network access

1. Find the host address on the network the phone uses: `ip -4 -brief address` (for example
   `192.168.1.203` on the Wi-Fi/Ethernet interface; ignore Docker/VPN/virtual adapters).
2. Build once (`npm run build`), then start with the usual database variables and:

   ```bash
   AI_TASKS_HOST=192.168.1.203 npm start
   ```

3. Open the printed URL on the phone. Stop with Ctrl+C (or SIGTERM).
4. Plain `npm start` keeps loopback-only access at `http://127.0.0.1:3000`.

Every device on that network can read and change all data; there is no sign-in. On the phone,
loaded data stays readable in an open tab without the network, but the app cannot be reloaded or
reopened offline over plain HTTP.

## Validation record

Run on 2026-10-31, Node 24.22.0, npm 11.19.1, Linux host with LAN address 192.168.1.203.
Logs are under ignored `artifacts/checks/003-lan/`.

| Command | Result | Duration |
| --- | --- | --- |
| `npm run typecheck` | exit 0 | 32s |
| `npm run lint` | exit 0 | 50s |
| `npm run format:check` | exit 0 | 16s |
| `npm run build` | exit 0 | 6s |
| `npm run check:bundle-size` | exit 0, passed (no UI change) | 1s |
| `npm run test:functional` | exit 0; 130 files, 1713 tests passed, including the new unit and network contract cases (the real-address case ran, not skipped) | 158s |
| `npm run test:e2e -- tests/e2e/board-http-origin.spec.ts tests/e2e/browser-uuid-http.spec.ts` | exit 0; 4 passed | 35s |

Not run: contention suite and full browser matrix (no lock, transaction or UI change), and
benchmarks. The first e2e attempt failed with exit 1 because the owner's previous manual
server occupied 127.0.0.1:3000; it passed after that server was stopped.

T010: the manual `socat` bridge and loopback server were stopped. `AI_TASKS_HOST=192.168.1.203
npm start` printed the URL and warning; `http://192.168.1.203:3000/` returned the shell and
project list, and 127.0.0.1:3000 refused connections. Opening the app on a physical phone has
not been verified by the agent.

### PR #1 review follow-up (2026-10-31)

Codex review correctly found that offline reopening does not work over plain HTTP (no
service worker outside a secure context); the validation above covered writes only. After
narrowing the spec (FR-007/FR-011): `npm run test:e2e -- tests/e2e/board-http-offline.spec.ts
tests/e2e/board-http-origin.spec.ts tests/e2e/browser-uuid-http.spec.ts` exit 0, 6 passed
(51s); the first run of the new spec failed in WebKit because a failed offline reload keeps the
old document, so the check now reopens in a new tab. Typecheck, lint, format check and build
exit 0; targeted functional files (`serve-network`, `listen-address`, `bootstrap`) 41 passed.
The full functional suite and browser matrix run in CI.
