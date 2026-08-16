# 04 — Backlog: agent inbox, mobile panel, remote access

> Requested 2026-08-16, **after** the phases in `03-BACKLOG.md`. Not scheduled yet.
> Reference: the Grok Bot product page (already cited in `00-VISION.md § 5` — take the
> mental model, not the branding, and never the desktop-control-by-vision part).

Three things that arrived together because they are the same wish: **talk to every agent
from anywhere, including a phone.**

---

## A — Agent inbox: one conversation list across every agent

**What it is.** A left rail listing every agent as a conversation — avatar, name, timestamp,
and a one-line preview of the *last thing it said* — with the chat on the right. Click an
agent, keep talking. The reference screenshots show exactly this: `Chief`, `Inbox Manager`,
`Account Manager`, `Talent Scout`, each with its own thread and a live "Typing…" state.

**Why it is not what we have.** APX already has agents, per-agent conversations and a chat
UI, but they are reached **project-first**: pick a project, then a tab, then an agent. The
inbox inverts that. The unit becomes the *conversation with an agent*, and the project
becomes an attribute of it. For someone running several projects — the whole premise of the
secretary profile — that inversion is the point.

**What already exists and must be reused** (AGENTS.md rule 50 — do not re-implement):

| Need | Existing |
|---|---|
| Per-agent conversations | `GET /projects/:pid/agents/:slug/conversations` (`api/conversations.js`) |
| Chat UI parts | `components/chat/` — `ChatList`, `MessageList`, `MessageBubble`, `Composer` |
| The agent roster | `readVaultAgents()` + `.apc/agents/`, `api/agents.js` |
| Cross-channel history | `~/.apx/messages/<channel>/*.jsonl`, `appendGlobalMessage()` |
| Live updates | the daemon's WebSocket hubs |
| Inline questions/answers | `AskQuestionsCard` / `InlineAskPanel` (buttons, not open questions) |

**The one real gap:** there is no cross-project "all agents, most recent first" reader. That
is the same shape as **C2** in `02-SPEC-capabilities.md` (cross-project task aggregation) —
walk the registered projects, attach `project_id`/`project_name`, sort, cap. Do C2 first and
this becomes a second consumer of the same aggregation, not a parallel one.

**Worth stealing from the reference, cheaply:**
- The last line of the preview is the agent's *result*, not the user's prompt
  ("report filed. 9 receipts, nothing over policy"). That reads as a colleague reporting
  back. It costs nothing and changes how the list feels.
- A visible tool-run summary in the thread (`✓ Salesforce → 52 accounts`) — APX already
  captures this as `tool_trace` in message meta; it is a rendering job, not a new capability.
- Cross-agent handoffs shown inline ("Account Manager sent over the threads"). APX has
  `call_agent` and `run_subagent`; the trace exists, it is just not surfaced.
- The "Created routine · Overnight outbound" chip after the user says *"run this every
  week"*. APX already turns that into a real routine — showing the chip closes the loop and
  makes the routine discoverable at the moment it is created.

**Explicitly not taking:** desktop control by vision and coordinates. `00-VISION.md` already
settled that — for project management, APIs and MCP win every time.

---

## B — Responsive panel (phone-usable)

**Today.** The panel assumes a desktop. `useIsMobile()` exists (`hooks/use-mobile.ts`,
768px breakpoint) but is used **only** by `components/ui/sidebar.tsx` — nothing else adapts.
`TabLayout`, the project rail and the settings two-column grids are all desktop-shaped.

**Scope.** Not "make everything responsive" — make the *inbox* responsive. On a phone that
is: list ⇄ thread as two views with a back button, one column, composer pinned to the bottom
with the keyboard, no rail. Everything else can stay desktop-only until asked for.

**Constraint that helps:** `channels/web_sidebar.md` already tells the agent to keep replies
short on that surface. A phone view should use the same short-reply channel rather than the
long-form `web` one — otherwise it will be correct and unreadable.

**Playwright:** the harness supports viewports; a mobile spec belongs with the feature
(rule 11).

---

## C — Remote access to the panel

> **Scope corrected by the owner:** this means **reaching the panel from a phone on the same
> LAN** (`http://192.168.1.40:7430`), not exposing it to the internet. The public-tunnel
> design below is **archived, not discarded** — kept because the objection it records still
> applies the day someone wants it.

### C1 — LAN bind (this is the actual work)

The daemon listens on loopback. The job is to let it also bind the LAN interface and print
the real URL. `core/config/paths.js` + `effectiveHost()` in `core/config/index.js` already
model the host, so this is a small change plus a loud command.

Non-negotiable shape:

- `127.0.0.1` stays the **default**. A LAN bind is explicit opt-in, never a side effect.
- **Never `0.0.0.0` by default.** Bind the specific LAN address.
- The command is **loud**: it prints the IP, the port, and one line saying exactly what is
  now reachable to anyone on that network — because a LAN can be a café or a coworking.
- The existing auth (web token / device pairing, `api/pairing.js`) stays **mandatory**.
  Never a bind without auth, not even on a LAN.
- A QR of the URL in the terminal is a nice-to-have. Skip it if it is not cheap.

### C2 — Public tunnel (ARCHIVED)

Kept for the day this is wanted. **The good news: most of it already exists.** `src/core/artifacts/tunnel.js` wraps
zero-config tunnel providers — **cloudflared** first (`cloudflare tunnel --url
http://localhost:PORT`), localtunnel as fallback — spawns the provider, scrapes the public
URL, and is already driven over HTTP by `api/artifact-preview.js`
(`POST /previews/:id/tunnel`). It is built for artifact previews, but nothing about it is
artifact-specific.

**So the work is not "add Cloudflare", it is "point the existing tunnel at the daemon port
and make that safe."** Safety is the whole job:

- An artifact preview is a throwaway page. The **panel is the whole system** — config,
  message history, shell-capable tools. A `trycloudflare.com` URL is public to anyone who
  learns it.
- The panel authenticates with a bearer from `/admin/web-token`. Before exposing it, work
  out what that token is worth to someone who guesses the hostname, and whether it needs a
  second factor, a short TTL, or the existing device-pairing flow (`api/pairing.js`,
  `PairingScreen`) as the only way in.
- Quick tunnels are ephemeral and the URL changes every restart. A named Cloudflare tunnel
  with a stable hostname is the real answer for daily use, and needs a Cloudflare account —
  a different setup story worth documenting rather than hiding.
- This must be **opt-in and loud**. `apx panel share` (or similar) printing exactly what is
  now reachable, with `apx panel unshare`. Never on by default, never a silent side effect
  of something else.

**The objection that archived this:** an artifact preview is a throwaway page; the panel is
the whole system, and the threat model of a guessable public hostname is not the threat model
of a home LAN. That distinction is exactly why the LAN bind is fine and the tunnel is not —
yet.

---

## Suggested order

1. **C2** (already in `03-BACKLOG.md`) — the cross-project aggregation both A and the
   secretary's anchors need.
2. **A** — the inbox, desktop first, reusing the chat components.
3. **B** — make the inbox phone-shaped.
4. **C** — expose it, with the auth question answered first.

## Answered by the owner

- **The inbox coexists with project navigation — two axes, not two versions of one thing.**
  The inbox is the default entry point: open the panel, see conversations, most recent first.
  That is how the system gets used daily. **Project-first navigation stays intact and must
  not degrade.** Projects as a first-class unit with versioned context is APX's differentiator
  against any personal assistant; if the inbox eats it, the one thing a competitor cannot copy
  is gone. *Conversational entry, project structure. Both.*
- **The super-agent is pinned, always first, visually distinct.** It is the only voice that
  speaks to the owner and the others report to it. The hierarchy should be visible.
- **LAN access needs no second factor** — the existing pairing/token is enough. The question
  reopens only if public exposure is ever built.

## Constraint raised late

**Each project agent already has its own Telegram option** — a direct line to that agent
without going through the super-agent. Never used so far, but it must **not** be removed or
degraded by this work. Treat it as another entry point into the same conversation, not as
something the inbox supersedes.
