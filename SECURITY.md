# Security

## Daemon authentication

The APX daemon exposes a local HTTP API (default `127.0.0.1:7430`). Starting from the fixes described below, every request to the daemon **must include a bearer token** that is generated fresh at each daemon startup:

```
Authorization: Bearer <token>
```

The token is written to `~/.apx/daemon.token` with mode `0600` (owner-read-only) when the daemon starts. The APX CLI reads it automatically — no manual configuration required.

The only unauthenticated endpoint is `GET /health`, used by the CLI to check whether the daemon is alive before reading the token file.

**Why this matters:** Without authentication, any process running as the same OS user (e.g. a compromised npm dependency or a malicious script) could call the daemon API and create persistent shell routines, execute arbitrary commands via `/run`, or read project memory and session data. The token ensures only processes that can read `~/.apx/daemon.token` — i.e. processes running as the daemon owner — can interact with the API.

## SSRF protection in the HTTP fetch tool

The `http_get` / `http_post` / `http_request` agent tools (backed by `src/daemon/tools/fetch.js`) validate every URL before issuing the request. The following are rejected with an error:

| Category | Blocked examples |
|---|---|
| Non-HTTP protocols | `file://`, `ftp://`, `javascript:` |
| Loopback | `127.0.0.0/8`, `::1`, `localhost` |
| Private networks | `10.x.x.x`, `172.16–31.x.x`, `192.168.x.x` |
| Link-local / cloud metadata | `169.254.x.x` (AWS, Azure), `fd00:ec2::/32` |
| GCP metadata | `metadata.google.internal` |

This prevents an agent — whether acting on a crafted prompt or a malicious routine — from reaching cloud instance-metadata endpoints (e.g. `http://169.254.169.254/latest/meta-data/`) and exfiltrating IAM credentials or other cloud secrets.

## Reporting a vulnerability

Open a private GitHub Security Advisory at:
`https://github.com/agentprojectcontext/apx/security/advisories/new`

Please include a description of the issue, reproduction steps, and potential impact. We aim to respond within 48 hours.
