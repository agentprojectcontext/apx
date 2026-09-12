# Per-engine egress proxy

Send **one** model provider's traffic through a VPN and leave the rest of APX
on the normal route.

## Why a proxy and not a VPN client

A VPN app on the host rewrites the routing table, which is the same table
Tailscale needs. The two fight, and the usual fix — split tunnelling — has to
be re-taught every exclusion by hand. Here the tunnel lives inside a container,
so the host's networking is never touched: Tailscale keeps its routes and its
connection, and what reaches APX is an ordinary HTTP proxy on loopback.

It is also narrower. `HTTPS_PROXY` and Node's `--use-env-proxy` are
process-wide, and the APX daemon talks to Telegram, several providers, the
vault and the update check from that one process. `engines.<id>.proxy` moves
one provider and nothing else.

## Setup

```bash
cp .env.example .env     # fill in WIREGUARD_PRIVATE_KEY
docker compose up -d
curl -x http://127.0.0.1:8888 https://api.ipify.org && echo
```

That last line prints the exit IP. If it matches your own, the tunnel is not
up — check `docker compose logs gluetun`.

Then point one engine at it in `~/.apx/config.json`:

```json
{
  "engines": {
    "zen": { "proxy": "http://127.0.0.1:8888" }
  }
}
```

`apx restart`, and only that engine goes out through the VPN. Verify with
`apx model status`, or watch the provider's own view of your address.

## Changing exit server

```bash
docker compose restart gluetun
```

It reconnects to another server matching `SERVER_COUNTRIES`. Widen the filter
for a bigger pool, narrow it to stay in one country. gluetun's control server
on `127.0.0.1:8000` can do the same without a restart — see the gluetun docs.

## Notes

- Both ports are bound to `127.0.0.1`. A proxy reachable from the LAN is an
  open relay; do not publish them.
- `.env` holds a private key and is gitignored. Keep it that way.
- A proxy configured but unreachable **fails the call**. It does not quietly
  fall back to the direct route — that would send the traffic exactly where you
  set this up to avoid.
