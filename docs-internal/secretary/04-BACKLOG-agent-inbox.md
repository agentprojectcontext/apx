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

**The good news: most of this already exists.** `src/core/artifacts/tunnel.js` wraps
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

**Do this last of the three.** A phone-shaped panel behind a tunnel is worth a lot; a
desktop-shaped one behind a tunnel is worth little and carries the same risk.

---

## Suggested order

1. **C2** (already in `03-BACKLOG.md`) — the cross-project aggregation both A and the
   secretary's anchors need.
2. **A** — the inbox, desktop first, reusing the chat components.
3. **B** — make the inbox phone-shaped.
4. **C** — expose it, with the auth question answered first.

## Open questions for the owner

- Does the inbox **replace** the project-first navigation or sit beside it? Replacing is
  cleaner and riskier; beside it is safe and leaves two ways to do one thing.
- Do the super-agent and project agents share one list, or does the super-agent stay pinned
  at the top the way `Chief` is in the reference?
- Phone access: is device pairing enough, or does exposure need an explicit second factor?
