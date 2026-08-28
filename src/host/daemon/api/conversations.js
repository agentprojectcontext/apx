// Per-agent conversation surface: list, fetch, compact, and a2a /send.
//   GET  /projects/:pid/agents/:slug/conversations
//   GET  /projects/:pid/agents/:slug/conversations/:id
//   GET  /projects/:pid/super-agent/threads                    (channel ledger)
//   GET  /projects/:pid/super-agent/threads/:channel/:id
//   POST /projects/:pid/agents/:slug/compact
//   POST /projects/:pid/agents/:slug/conversations/:id/compact
//   POST /projects/:pid/send                                   (agent-to-agent)
import fs from "node:fs";
import { readAgents } from "#core/apc/parser.js";
import { listConversations, readConversation, deleteConversation, truncateConversation, setConversationMeta, shapeConversationMessage } from "#core/stores/conversations.js";
import { listGlobalThreads, readGlobalThread, deleteGlobalThread, setGlobalThreadMeta, listProjectA2AThreads, readProjectA2AThread, listProjectGroupThreads, readProjectGroupThread, deleteGroupThread, readProjectMessages, readA2APeerSession } from "#core/stores/messages.js";

// Prior turns of an a2a thread between `from` and `to`, oldest→newest, shaped as
// LLM messages from `viewer`'s side (its own lines = assistant, the peer's =
// user). This is what gives an a2a reply MEMORY: without it every --deliver is a
// stateless one-shot and the agent forgets the previous turn. Loaded BEFORE the
// current message is logged, so it excludes it.
function a2aPairHistory(storageRoot, from, to, viewer, limit = 24) {
  const pair = new Set([from, to]);
  const rows = readProjectMessages(storageRoot, { channel: "a2a", limit: 300 }).filter((m) => {
    const parts = [m.agent_slug, m.author, m.meta?.from, m.meta?.to].filter(Boolean);
    return parts.length > 0 && parts.every((s) => pair.has(s));
  });
  // Collapse the double-logged rows (one under each peer), keeping the copy
  // written under the speaker's own ledger.
  const best = new Map();
  for (const m of rows) {
    const k = `${m.ts}|${m.author}|${(m.body || "").slice(0, 120)}`;
    const cur = best.get(k);
    if (!cur || (m.agent_slug === m.author && cur.agent_slug !== cur.author)) best.set(k, m);
  }
  return [...best.values()]
    .sort((a, b) => (a.ts || "").localeCompare(b.ts || ""))
    .slice(-limit)
    .map((m) =>
      m.author === viewer
        ? { role: "assistant", content: m.body || "" }
        : { role: "user", content: `From ${m.author}:\n\n${m.body || ""}` },
    );
}
/** The sender's working directory, if it still is one. This is untrusted input
 *  naming a directory we are about to spawn a coding CLI in, so it gets checked
 *  rather than believed; anything else falls back to the project path. */
function senderCwd(raw) {
  if (!raw || typeof raw !== "string") return null;
  try {
    return fs.statSync(raw).isDirectory() ? raw : null;
  } catch {
    return null;
  }
}

import { compactConversation } from "#core/stores/conversations-compactor.js";
import { getActiveTurnByKey, convTurnKey } from "../active-turns.js";
import { replyToPeer } from "#core/agent/a2a/reply.js";
import { resolvePeer, refusesCodeMode, NO_CODE_PEERS } from "#core/agent/a2a/peers.js";
import { createCodeSession, getCodeSession, appendTurn as appendCodeTurn } from "#core/stores/code-sessions.js";
import { CODE_MODES } from "#core/constants/code-modes.js";
import { RUNTIME_IDS } from "#core/runtimes/index.js";
import { resolveAgentModel } from "#core/agent/agent-model.js";
import { notifyOwnerViaRoby } from "#core/routines/delivery.js";
import { A2A_SEVERITY } from "#core/routines/signals.js";
import { nowIso, asyncRoute, a2aSlugThreadId, rejectA2AWrite } from "./shared.js";
import { faceResolverFor, readAgentsSafe } from "./thread-faces.js";

export function register(api, { projects, project, config, plugins, registries }) {
  // The super-agent (default name "apx") is a pseudo-agent: it owns
  // conversations per project but is NOT listed in AGENTS.md. Resolve its slug
  // so `apx conversations list` (which defaults to the super-agent) works
  // instead of 404-ing on the AGENTS.md check.
  const superAgentSlug = () => config?.super_agent?.name || "apx";
  const agentResolvable = (p, slug) =>
    slug === superAgentSlug() || readAgents(p.path).some((a) => a.slug === slug);

  // The inbox lists a2a "group chats" under a SYNTHETIC slug, `a2a:<pairId>`
  // (see api/inbox.js) — a pair exchange is nobody's individual conversation,
  // so it has no agents/<slug>/conversations/ directory. Those rows are opened
  // through this same per-agent surface, so unless the slug resolves here every
  // a2a row in the inbox dead-ends on "agent not found".
  //
  // NOT a URL-parsing problem: Express hands `a2a:cursor~roby` through intact,
  // percent-encoded or not (verified both ways against the running daemon).
  // The id was reaching the handler fine; there was simply no code path that
  // could read a pair thread. `readProjectA2AThread` already existed and
  // already returns the viewer's shape — it was never wired to a route.

  api.get("/projects/:pid/agents/:slug/conversations", (req, res) => {
    const p = project(req, res);
    if (!p) return;
    const listA2A = a2aSlugThreadId(req.params.slug);
    if (listA2A !== null) {
      const found = listProjectA2AThreads(p.storagePath).find((t) => t.id === listA2A);
      const th = found && faceResolverFor(projects).decorate(found, readAgentsSafe(p.path));
      // One pair id is one thread. Shaped like a conversation summary so the
      // sidebar renders it beside the ordinary ones.
      return res.json(th ? [{
        id: th.id,
        filename: `${th.id}.a2a`,
        agent_slug: req.params.slug,
        started_at: th.started_at || "",
        last_turn_at: th.last_ts || th.started_at || "",
        channel: "a2a",
        messages: th.messages,
        title: th.title,
        participants: th.participants,
        participant_faces: th.participant_faces,
        preview: th.preview || undefined,
        preview_at: th.last_ts || undefined,
      }] : []);
    }
    if (!agentResolvable(p, req.params.slug))
      return res.status(404).json({ error: "agent not found" });
    res.json(
      listConversations(p.storagePath, req.params.slug, {
        includeArchived: req.query.include_archived === "1",
      }),
    );
  });

  // Rename, or put away. Archiving is the smaller decision — the file stays
  // exactly where it is and only drops out of the lists that offer chats to
  // resume, so it stays a decision you can take back.
  api.patch("/projects/:pid/agents/:slug/conversations/:id", (req, res) => {
    const p = project(req, res);
    if (!p) return;
    // An a2a thread is derived from the message ledger, not a file with
    // frontmatter, so there is nothing to rename or archive. Say that, rather
    // than the misleading "agent not found" this used to answer.
    if (rejectA2AWrite(req, res, "renamed or archived")) return;
    if (!agentResolvable(p, req.params.slug))
      return res.status(404).json({ error: "agent not found" });
    const { title, archived } = req.body || {};
    if (title === undefined && archived === undefined)
      return res.status(400).json({ error: "nothing to change" });
    const ok = setConversationMeta(p.storagePath, req.params.slug, req.params.id, {
      ...(title !== undefined ? { title } : {}),
      ...(archived !== undefined ? { archived: !!archived } : {}),
    });
    if (!ok) return res.status(404).json({ error: "conversation not found" });
    res.json({ ok: true });
  });

  api.get("/projects/:pid/agents/:slug/conversations/:id", (req, res) => {
    const p = project(req, res);
    if (!p) return;
    const detailA2A = a2aSlugThreadId(req.params.slug);
    if (detailA2A !== null) {
      const found = readProjectA2AThread(p.storagePath, detailA2A || req.params.id);
      if (!found) return res.status(404).json({ error: "conversation not found" });
      const th = faceResolverFor(projects).decorate(found, readAgentsSafe(p.path));
      return res.json({
        id: th.id,
        agent_slug: req.params.slug,
        channel: "a2a",
        messages: th.messages,
        meta: {
          channel: "a2a",
          title: th.title,
          participants: th.participants,
          participant_faces: th.participant_faces,
        },
      });
    }
    const conv = readConversation(p.storagePath, req.params.slug, req.params.id);
    if (!conv) return res.status(404).json({ error: "conversation not found" });
    // Shape the response as the `ConversationDetail` the web client expects:
    // `messages[]` (mapped from the parsed `turns`) + id/agent/channel. Without
    // this the client's `detail.messages.filter(...)` throws on every load.
    //
    // `active_turn` is the turn being written RIGHT NOW, if any — so a surface
    // opening (or re-opening) this chat mid-answer shows the partial and then
    // follows the live "turn" frames, instead of a blank pane that fills all at
    // once when the turn happens to finish.
    res.json({
      id: req.params.id,
      agent_slug: req.params.slug,
      channel: conv.fm?.channel,
      messages: (conv.turns || []).map(shapeConversationMessage),
      meta: conv.fm || {},
      active_turn: getActiveTurnByKey(convTurnKey(p.id, req.params.id)),
    });
  });

  api.delete("/projects/:pid/agents/:slug/conversations/:id", (req, res) => {
    const p = project(req, res);
    if (!p) return;
    if (rejectA2AWrite(req, res, "deleted")) return;
    if (!agentResolvable(p, req.params.slug))
      return res.status(404).json({ error: "agent not found" });
    const ok = deleteConversation(p.storagePath, req.params.slug, req.params.id);
    if (!ok) return res.status(404).json({ error: "conversation not found" });
    res.json({ ok: true });
  });

  // Rewind a conversation to its first `turns` turns, dropping the rest. Backs
  // "regenerate" and "edit & resend": the pane rewinds to a turn and the file
  // must rewind with it, or a project agent (whose history the daemon rebuilds
  // from this file) would keep answering with the dropped turns still present.
  api.post("/projects/:pid/agents/:slug/conversations/:id/truncate", (req, res) => {
    const p = project(req, res);
    if (!p) return;
    if (rejectA2AWrite(req, res, "truncated")) return;
    if (!agentResolvable(p, req.params.slug))
      return res.status(404).json({ error: "agent not found" });
    const keepVisible = Number(req.body?.keep_visible);
    if (!Number.isInteger(keepVisible) || keepVisible < 0)
      return res.status(400).json({ error: "keep_visible must be a non-negative integer" });
    const ok = truncateConversation(p.storagePath, req.params.slug, req.params.id, { keepVisible });
    if (!ok) return res.status(404).json({ error: "conversation not found" });
    res.json({ ok: true });
  });

  // ---- Super-agent channel threads ----
  // The super-agent's chats (telegram, web quick-chat, desktop, deck …) live
  // in the global per-channel ledger, not in per-agent conversation files.
  // These endpoints surface that ledger as day-threads so the web Chats
  // sidebar can list and reopen them.
  //
  // Scope: each project lists only the super-agent chats that happened in it.
  // The default workspace (project 0) additionally owns every unstamped turn —
  // Telegram, desktop and deck have no project of their own, so that is where
  // those conversations live. Passing `undefined` for project 0, as this used
  // to, means "no filter", and the unstamped-rows-belong-everywhere rule it
  // paired with then listed the same ~90 Telegram threads under every project.
  // Channel grouping is untouched: a project with its own Telegram routing
  // still gets a Telegram group holding just its chats.
  const threadScope = (p) => String(p.id);

  api.get("/projects/:pid/super-agent/threads", (req, res) => {
    const p = project(req, res);
    if (!p) return;
    // Global channel threads (telegram/web/desktop…) live in the cross-project
    // ledger; a2a "group chats" are project-scoped, so they come from this
    // project's own messages. Both fold into the same channel-grouped sidebar.
    const global = listGlobalThreads({
      project: threadScope(p),
      includeArchived: req.query.include_archived === "1",
    });
    let a2a = [];
    try { a2a = listProjectA2AThreads(p.storagePath); } catch { /* best-effort */ }
    let groups = [];
    try { groups = listProjectGroupThreads(p.storagePath); } catch { /* best-effort */ }
    // a2a and group threads carry their participants' faces and a title made of
    // real names — the same decoration the inbox rows get, from the same
    // resolver (thread-faces.js). Without it the sidebar had to re-derive faces
    // from its own agent list (which does not know the super-agent or a coding
    // CLI) and the thread header, having no list at all, fell back to printing
    // the raw pair id: `andy~claude-code` where "Andy · Claude" belongs.
    const faces = faceResolverFor(projects);
    const agents = readAgentsSafe(p.path);
    const decorated = [...a2a, ...groups].map((th) => faces.decorate(th, agents));
    res.json([...global, ...decorated]);
  });

  api.get("/projects/:pid/super-agent/threads/:channel/:id", (req, res) => {
    const p = project(req, res);
    if (!p) return;
    // a2a threads are keyed by participant-pair id, not a date — read them from
    // the project ledger; everything else is a global channel+date thread.
    const thread = req.params.channel === "a2a"
      ? readProjectA2AThread(p.storagePath, req.params.id)
      : req.params.channel === "group"
      ? readProjectGroupThread(p.storagePath, req.params.id)
      : readGlobalThread({
          channel: req.params.channel,
          date: req.params.id,
          project: threadScope(p),
        });
    if (!thread) return res.status(404).json({ error: "thread not found" });
    // Same decoration as the list: whoever opens a thread directly (a deep link,
    // the phone, a pane that was handed no row) gets the faces and the name with
    // the messages, instead of having to ask a second surface for them.
    res.json(faceResolverFor(projects).decorate(thread, readAgentsSafe(p.path)));
  });

  api.delete("/projects/:pid/super-agent/threads/:channel/:id", (req, res) => {
    const p = project(req, res);
    if (!p) return;
    // A group is a ledger thread of its own — delete every row for it, not a
    // global channel+date file (which is what 404'd before).
    if (req.params.channel === "group") {
      const out = deleteGroupThread(p.storagePath, req.params.id);
      try { projects.rebuild(p.id); } catch { /* best-effort */ }
      if (!out.removed) return res.status(404).json({ error: "thread not found" });
      return res.json({ ok: true, ...out });
    }
    const ok = deleteGlobalThread({
      channel: req.params.channel,
      date: req.params.id,
      project: threadScope(p),
    });
    if (!ok) return res.status(404).json({ error: "thread not found" });
    res.json({ ok: true });
  });

  // A channel thread has no file of its own to carry a name, so the two
  // decisions a reader can make about one — what to call it, whether to put it
  // away — live in a small index beside the ledger. The messages are untouched.
  api.patch("/projects/:pid/super-agent/threads/:channel/:id", (req, res) => {
    const p = project(req, res);
    if (!p) return;
    const { title, archived } = req.body || {};
    if (title === undefined && archived === undefined)
      return res.status(400).json({ error: "nothing to change" });
    const ok = setGlobalThreadMeta({
      channel: req.params.channel,
      date: req.params.id,
      ...(title !== undefined ? { title } : {}),
      ...(archived !== undefined ? { archived: !!archived } : {}),
    });
    if (!ok) return res.status(404).json({ error: "thread not found" });
    res.json({ ok: true });
  });

  async function handleCompact(req, res, filename) {
    const p = project(req, res);
    if (!p) return;
    if (rejectA2AWrite(req, res, "compacted")) return;
    const agents = readAgents(p.path);
    const agent = agents.find((a) => a.slug === req.params.slug);
    if (!agent) return res.status(404).json({ error: "agent not found" });
    const modelId = await resolveAgentModel({
      agent,
      config: p.config || config,
      override: (req.body || {}).model,
    });
    if (!modelId) return res.status(400).json({ error: "agent has no model" });
    try {
      const result = await compactConversation({
        storagePath: p.storagePath,
        agentSlug: agent.slug,
        filename: filename || null,
        modelId,
        config: p.config || config,
      });
      res.json(result);
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  }

  api.post("/projects/:pid/agents/:slug/compact", (req, res) =>
    handleCompact(req, res, null)
  );

  api.post(
    "/projects/:pid/agents/:slug/conversations/:id/compact",
    (req, res) => handleCompact(req, res, req.params.id)
  );

  // ---- Agent-to-agent routing ----
  api.post("/projects/:pid/send", asyncRoute(async (req, res) => {
    const p = project(req, res);
    if (!p) return;
    const { from, to, body, deliver = false, _depth = 0, requested_by = null, severity = null, model = null, usage = null, code = false, background = false, timeout_s = null } = req.body || {};
    // Two kinds of exchange, and the difference is real: a `chat` peer runs in
    // its own read-only mode, a `code` peer may write. Chat is the default
    // because receiving a message must not be enough to let the sender rewrite
    // your checkout — opening a coding session is a decision.
    const mode = code ? "code" : "chat";
    // A conversation answers in seconds; a coding session does not. Background
    // runs get the hour that `call_runtime` gives its own detached spawns.
    const timeoutMs = (Number(timeout_s) || (background ? 3600 : 300)) * 1000;
    if (!from || !to || !body)
      return res.status(400).json({ error: "from, to, body required" });
    if (_depth > 3)
      return res.status(429).json({ error: "a2a depth limit (3) exceeded" });

    // Urgency tag: blocker|status|fyi. Only a known tag is kept — an unknown one
    // is dropped rather than stored as a severity the detector can't map.
    const sevTag = severity && A2A_SEVERITY[String(severity).toLowerCase()]
      ? String(severity).toLowerCase() : null;
    const sevMeta = sevTag ? { severity: sevTag } : {};

    const agents = readAgents(p.path);
    // The SENDER may be a project agent, the super-agent, or an external
    // identity that isn't registered anywhere — a coding CLI (claude/codex/…)
    // relaying to an agent, a routine, a system actor. Requiring `from` to be an
    // AGENTS.md agent is what blocked CLI→agent relays (404 "from not found").
    // A synthetic sender ({slug}) is enough: the reply layer only reads `from.slug`,
    // and the a2a log records the label. The RECIPIENT still has to exist, so a
    // typo'd or wrong-project target fails loudly instead of vanishing.
    const fromAgent = agents.find((a) => a.slug === from) || { slug: from, fields: {}, synthetic: true };
    // The RECIPIENT is a PEER, not necessarily an agent: `to` may name an
    // AGENTS.md agent or an external coding runtime (opencode, codex,
    // claude-code, …), optionally with a `#thread` suffix that keeps two
    // exchanges with the same peer from reading each other's mail. A name that
    // nothing claims still fails loudly rather than vanishing.
    const peer = resolvePeer(to, agents);
    if (!peer)
      return res.status(404).json({
        error: `no agent or runtime "${to}" in project "${p.name}"`,
        project: p.name,
        available: agents.map((a) => a.slug),
        runtimes: RUNTIME_IDS,
        hint: "run `apx agent list --all` for agents and their projects; a runtime peer is any id in `runtimes`",
      });

    if (mode === "code" && refusesCodeMode(peer)) {
      return res.status(400).json({
        error: `"${peer.runtime}" cannot be opened as a --code peer`,
        no_code_peers: NO_CODE_PEERS,
        hint:
          `${peer.runtime} is a CLI you drive yourself — a message must not also start it writing to the same ` +
          `checkout. Send without --code to ask it something, or open the coding session on another peer.`,
      });
    }

    // Snapshot the prior conversation BEFORE we log the new message, so the
    // reply sees history without the turn it is answering.
    const history = deliver ? a2aPairHistory(p.storagePath, from, to, to) : [];

    // Attribute the sender's message the way every other channel does: an
    // explicit override wins (a caller that knows the real cost — a routine
    // relaying its run — passes model/usage); otherwise stamp the sender agent's
    // configured model, so an a2a message shows whose model spoke instead of a
    // blank row. Usage stays absent on a plain relay — it spends no tokens.
    const attrib = {};
    const overrideModel = typeof model === "string" && model ? model : null;
    let senderModel = overrideModel;
    if (!senderModel && !fromAgent.synthetic) {
      try { senderModel = await resolveAgentModel({ agent: fromAgent, config: p.config || config }); }
      catch { /* no model resolvable → leave the row unattributed */ }
    }
    if (senderModel) attrib.model = senderModel;
    if (usage && typeof usage === "object") attrib.usage = usage;

    const ts = nowIso();
    p.logMessage({
      agent_slug: from,
      channel: "a2a",
      direction: "out",
      author: from,
      body,
      meta: { to, depth: _depth, final: true, ...sevMeta, ...attrib, ...(requested_by ? { requested_by } : {}) },
      ts,
    });

    // A `blocker` is an alert, not a note for the next digest: Roby pings the
    // owner in the act (canNudge's critical-bypass crosses budget and quiet
    // hours). Done here — before the inbound row a watch would pick up later —
    // so the ping never waits for a scheduled sweep. A successful ping stamps
    // the inbound row `owner_notified` so the watch does not tell him twice; if
    // it is held/skipped the flag is absent, so the watch remains the fallback.
    let ownerNotify = null;
    if (sevTag === "blocker") {
      try {
        ownerNotify = await notifyOwnerViaRoby(
          { project: p, plugins, registries, globalConfig: p.config || config },
          {
            routine: { name: `a2a:${from}->${to}`, id: "" },
            agent: { slug: from, name: from },
            text: body,
            notify: body,
            gate: { severity: "critical", scheduled: false, unsolicited: true, project_id: p.id ?? null },
            severity: "critical",
          },
        );
      } catch (e) {
        ownerNotify = { skipped: true, reason: e?.message || String(e) };
      }
    }
    const ownerNotified = ownerNotify?.sent === true;

    p.logMessage({
      agent_slug: to,
      channel: "a2a",
      direction: "in",
      author: from,
      body,
      meta: {
        from, depth: _depth, ...sevMeta, ...attrib,
        ...(ownerNotified ? { owner_notified: true } : {}),
        ...(requested_by ? { requested_by } : {}),
      },
      ts,
    });

    // Run the peer and file both halves of its answer. Returns the payload the
    // caller gets back; NEVER throws, so the background path can fire it
    // un-awaited without an unhandled rejection taking the daemon with it.
    // A --code exchange IS a coding session, so it has to live where coding
    // sessions live. Without this it exists only as an a2a thread and the Code
    // panel — the one place you go to see what was built — never shows it.
    // Sender is the user turn; the peer that does the work is the assistant,
    // which is the same shape /m/code writes for its own sessions.
    const openCodeSession = () => {
      if (mode !== "code") return null;
      const known = readA2APeerSession(p.storagePath, { from, to, key: "code_session_id" });
      let session = known ? getCodeSession(p.storagePath, known) : null;
      if (!session) {
        session = createCodeSession(p.storagePath, {
          projectId: p.id,
          title: `a2a: ${from} -> ${to}`,
          mode: CODE_MODES.BUILD,
          agentSlug: to,
        });
      }
      appendCodeTurn(p.storagePath, session.id, {
        role: "user",
        parts: [{ kind: "text", text: body }],
        mode: CODE_MODES.BUILD,
      });
      return session;
    };

    const runReply = async () => {
      const codeSession = openCodeSession();
      try {
        const result = await replyToPeer({
          peer,
          projectPath: p.path,
          fromAgent,
          fromAddress: from,
          body,
          config: p.config || config,
          history,
          // A runtime peer runs where the sender is, falling back to the
          // project. It also continues the session this thread already opened
          // instead of starting a stranger.
          cwd: senderCwd(req.body?.cwd) || p.path,
          projectName: p.name,
          resumeSessionId: readA2APeerSession(p.storagePath, { from, to }),
          mode,
          timeoutMs,
        });

        p.logMessage({
          agent_slug: to,
          channel: "a2a",
          direction: "out",
          type: "agent",
          actor_kind: "agent",
          actor_id: to,
          author: to,
          body: result.text,
          meta: {
            to: from,
            depth: _depth + 1,
            reply_to: fromAgent.slug,
            final: true,
            model: result.model,
            usage: result.usage,
            // Where this thread's external session lives, so the NEXT turn
            // resumes it. Stored on the ledger rather than in a side table: a
            // thread that gets deleted takes its session pointer with it.
            ...(result.runtime ? { runtime: result.runtime } : {}),
            ...(result.mode ? { mode: result.mode } : {}),
            ...(result.sessionId ? { runtime_session_id: result.sessionId } : {}),
            ...(codeSession ? { code_session_id: codeSession.id } : {}),
          },
        });
        if (codeSession) {
          appendCodeTurn(p.storagePath, codeSession.id, {
            role: "assistant",
            parts: [{ kind: "text", text: result.text }],
            mode: CODE_MODES.BUILD,
            ...(result.model ? { model: result.model } : { model: result.runtime || to }),
          });
        }
        p.logMessage({
          agent_slug: from,
          channel: "a2a",
          direction: "in",
          author: to,
          body: result.text,
          meta: { from: to, depth: _depth + 1 },
        });
        return {
          text: result.text,
          usage: result.usage,
          ...(result.runtime ? { runtime: result.runtime } : {}),
          ...(result.sessionId ? { session_id: result.sessionId } : {}),
          ...(result.sessionNote ? { session_note: result.sessionNote } : {}),
          ...(codeSession ? { code_session_id: codeSession.id } : {}),
        };
      } catch (e) {
        // A peer that did not answer is news, and in the background there is no
        // response left to carry it — so the failure goes on the thread, marked
        // as a failure rather than dressed up as something the peer said.
        p.logMessage({
          agent_slug: to,
          channel: "a2a",
          direction: "out",
          // attribution-exempt: a delivery failure, not a turn — nothing was
          // spent and no model spoke, so there is no model or usage to record.
          type: "agent",
          actor_kind: "agent",
          actor_id: to,
          author: to,
          body: `did not answer: ${e.message}`,
          meta: {
            to: from,
            depth: _depth + 1,
            reply_to: fromAgent.slug,
            final: true,
            failed: true,
            failure_reason: e.message,
            ...(codeSession ? { code_session_id: codeSession.id } : {}),
          },
        });
        // The coding session must show the failure too, or it reads as a
        // request nobody ever answered.
        if (codeSession) {
          appendCodeTurn(p.storagePath, codeSession.id, {
            role: "assistant",
            parts: [{ kind: "text", text: `did not answer: ${e.message}` }],
            mode: CODE_MODES.BUILD,
            model: to,
          });
        }
        return { error: e.message, ...(codeSession ? { code_session_id: codeSession.id } : {}) };
      }
    };

    // An agent that inherits still replies: replyToPeer resolves the router
    // default for it. `deliver` is the only gate here.
    let reply = null;
    if (deliver && background) {
      // Un-awaited on purpose: a coding session can run for an hour, and the
      // sender should not hold a socket open for it. The reply lands on the
      // thread when it lands, and every surface that reads the thread sees it.
      runReply();
      reply = { status: "delivering", background: true, timeout_s: Math.round(timeoutMs / 1000) };
    } else if (deliver) {
      reply = await runReply();
    }

    res.json({
      from, to, body, ts, reply,
      ...(sevTag ? { severity: sevTag } : {}),
      ...(ownerNotify ? {
        owner_notified: ownerNotified,
        ...(ownerNotify.line ? { owner_notified_line: ownerNotify.line } : {}),
        ...(!ownerNotified ? { owner_notify_reason: ownerNotify.reason || (ownerNotify.skipped ? "skipped" : "not sent") } : {}),
      } : {}),
    });
  }));
}
