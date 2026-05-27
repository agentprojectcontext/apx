# 09 — APX SO Android bridge

**Priority**: P3
**Size**: L
**Status**: specced (no work yet)

## Goal

Let an Android app (separate repo: `apx-so`) drive the local APX daemon from the user's phone. The phone is on the same LAN (or, later, behind a tunnel) and the daemon is the server. Same tools, same agents, same memory, same projects — just a different surface.

## Decision recap

- Android app: separate repo (decision 003).
- The **bridge server lives in this repo** as a daemon plugin + API module:
  - `src/host/daemon/plugins/remote.js` — lifecycle (start/stop), connection tracking.
  - `src/host/daemon/api/remote.js` — pairing endpoints + WS upgrade.

## Protocol sketch (subject to revision)

### Pairing (one-time per device)

1. User runs `apx remote pair` on the desktop. Daemon prints a 6-digit code + a QR.
2. The phone opens the APX SO app, scans the QR (or types the code).
3. Phone POSTs `/remote/pair { code, device_label, device_pubkey }` over HTTP. Daemon verifies code, stores a per-device token + pubkey in `~/.apx/remote/devices.json`.
4. Daemon responds with the bearer token specific to that device. Used for all future requests.

### Network exposure

- By default daemon binds `127.0.0.1`. For remote use, user must explicitly opt in: `apx config set remote.bind 0.0.0.0` + restart. Confirm on start with a warning.
- TLS strongly recommended once non-loopback. Self-signed cert generated on first remote start; pinned by the phone after pairing.

### Operations

- The phone uses the same REST API (`/projects/...`, `/messages`, etc.) with its device token.
- Real-time updates over WS at `/remote/ws` (project messages, super-agent stream tokens, routine status changes).

## Things explicitly out of scope for v1

- Cloud relays / tunnels (Tailscale, ngrok). Users who want that wire it themselves.
- Multi-user sharing. One user, multiple devices.
- Push notifications. Phone polls or holds WS open.

## What we need before starting

- Decide auth crypto: simple per-device bearer tokens (easier) vs Ed25519 signatures (stronger). Default v1: bearer.
- Decide WS vs SSE for live updates. Phone-side library availability matters.
- Decide if the Android app embeds a minimal LLM client to call APX engines, or strictly proxies through the daemon. Default v1: strict proxy.

## Done criteria (v1)

- [ ] `apx remote pair` produces a code + QR; phone can complete the pairing.
- [ ] Daemon can bind to `0.0.0.0` opt-in with a clear warning.
- [ ] Per-device tokens stored in `~/.apx/remote/devices.json`, listable with `apx remote devices list`.
- [ ] `/remote/ws` streams super-agent tokens to the paired device.
- [ ] Smoke test from a curl pretending to be the phone: pair → send message → get reply.

## Owner

TBD — not assigned. Open to whoever picks it up first.
