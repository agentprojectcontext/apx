# APX Web Admin Panel

Local-first React app served by the daemon. Operates every part of APX
(config, channels, projects, agents, routines, sessions, models, MCPs,
tasks) without leaving the browser.

> Rules: [`rules/web-ui.md`](../../../rules/web-ui.md) (how-to) ·
> [`rules/enforcement.md`](../../../rules/enforcement.md) (what is actually gated) ·
> No-Radix decision: [`rules/decisions/005`](../../../rules/decisions/005-no-radix-on-web-panel.md).
> The panel's own backlog is local-only under `spec/` and not linked from here.

## Stack

- **Vite + React 19 + TypeScript** (no Next.js — this is a local panel, SSR doesn't apply).
- **Tailwind CSS** with the shadcn-new design tokens (CSS vars).
- **@base-ui-components/react** for the few non-trivial primitives (popovers, dialogs).
- **SWR** for cache + revalidation.
- **lucide-react** for icons.
- No Radix dependencies, anywhere in the tree.

## Architecture

```
src/
├── main.tsx        ← React 19 root + Router
├── App.tsx         ← layout shell (sidebar + main)
├── styles.css      ← Tailwind + theme tokens (dark default)
├── lib/
│   ├── api/        ← ONE FILE PER RESOURCE (agents, routines, projects, …)
│   │                 uniform `export const X = {list,get,add,remove}`
│   ├── http.ts     ← the single typed client; Bearer auto-fetched
│   └── …           ← cn, live, notify, pwa, when, …
├── i18n/           ← en.ts + es.ts — every key in BOTH, always
├── components/
│   ├── ui/         ← curated Base UI primitives, behind the ui.tsx barrel
│   └── …
└── screens/
    └── modules/    ← one module per project area
```

**`lib/api/` is the rule, not a suggestion.** Nothing in the panel calls
`fetch` directly — `tests/web-guardrails.test.js` fails the build if it does.
This README described a single `lib/api.ts` long after it had been split into
one file per resource; that shape is now a reference implementation in
[`rules/architecture.md`](../../../rules/architecture.md).

## Talks to the daemon

The panel only consumes endpoints that already exist in `src/host/daemon/api/`.
Nothing new server-side. Mounting is done by `src/host/daemon/api/web.js`:

- **Same origin / same port** as the daemon (default `127.0.0.1:7430`).
- The daemon serves `dist/` from `/` and does an SPA fallback for unknown
  GETs that aren't an API prefix.
- `GET /api/admin/web-token` returns the bearer for loopback callers, so the
  panel can authenticate every subsequent request.

In development, `pnpm dev` boots Vite on `:7431` and proxies `/api` (the whole
daemon surface, WebSocket included) → `127.0.0.1:7430`. Hot reload, real daemon.

## Project typology

Each project's `.apc/project.json` may include an optional `kind`:

```json
{ "name": "acme", "apx_id": "...", "kind": "company" }
```

Recognised values (extensible, the daemon doesn't enforce anything special):

| kind        | icon | meaning |
|-------------|------|---------|
| `personal`  | 👤   | personal project / scratch space |
| `company`   | 🏢   | a company workspace |
| `app`       | 📱   | a single app / product |
| `software`  | 📦   | software / library / tool |
| `other`     | ●    | anything else (default) |

The sidebar uses `kind` to pick the avatar icon. Filtering / grouping is
ad-hoc per screen; nothing here is canonical taxonomy.

## Build + serve

```bash
# from the repo root, one-time
cd src/interfaces/web
pnpm install

# develop with hot reload (daemon must be running on :7430)
pnpm dev               # → http://127.0.0.1:7431

# build for production — the daemon will pick it up automatically
pnpm build             # writes ./dist
# then `apx daemon reload` (no restart needed; static serve is path-based)
# open http://127.0.0.1:7430
```

## What's pending

This is a first cut. The screens render but several actions are still
read-only:

- [ ] Edit per-project config inline (today: JSON viewer; needs form).
- [ ] Create / edit telegram channels from the panel (today: list-only).
- [ ] Run / enable / disable a routine from the panel (today: list).
- [ ] Threads view: render `/api/projects/:pid/agents/:slug/conversations`.
- [ ] APX self-chat surface (call /api/super-agent/chat/stream).
- [ ] Light theme toggle (tokens are there; missing the button).

Adding any of these is a single screen edit + an existing daemon endpoint.
