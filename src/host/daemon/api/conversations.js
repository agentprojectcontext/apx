// Per-agent conversation surface: list, fetch, compact, and a2a /send.
//   GET  /projects/:pid/agents/:slug/conversations
//   GET  /projects/:pid/agents/:slug/conversations/:id
//   GET  /projects/:pid/super-agent/threads                    (channel ledger)
//   GET  /projects/:pid/super-agent/threads/:channel/:id
//   POST /projects/:pid/agents/:slug/compact
//   POST /projects/:pid/agents/:slug/conversations/:id/compact
//   POST /projects/:pid/send                                   (agent-to-agent)
import { readAgents } from "#core/apc/parser.js";
import { listConversations, readConversation, deleteConversation, setConversationMeta, shapeConversationMessage } from "#core/stores/conversations.js";
import { listGlobalThreads, readGlobalThread, deleteGlobalThread, setGlobalThreadMeta, listProjectA2AThreads, readProjectA2AThread, readProjectMessages } from "#core/stores/messages.js";

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
import { compactConversation } from "#core/stores/conversations-compactor.js";
import { replyAsAgent } from "#core/agent/a2a/reply.js";
import { resolveAgentModel } from "#core/agent/agent-model.js";
import { notifyOwnerViaRoby } from "#core/routines/delivery.js";
import { A2A_SEVERITY } from "#core/routines/signals.js";
import { nowIso, asyncRoute } from "./shared.js";

export function register(api, { project, config, plugins, registries }) {
  // The super-agent (default name "apx") is a pseudo-agent: it owns
  // conversations per project but is NOT listed in AGENTS.md. Resolve its slug
  // so `apx conversations list` (which defaults to the super-agent) works
  // instead of 404-ing on the AGENTS.md check.
  const superAgentSlug = () => config?.super_agent?.name || "apx";
  const agentResolvable = (p, slug) =>
    slug === superAgentSlug() || readAgents(p.path).some((a) => a.slug === slug);

  api.get("/projects/:pid/agents/:slug/conversations", (req, res) => {
    const p = project(req, res);
    if (!p) return;
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
    const conv = readConversation(p.storagePath, req.params.slug, req.params.id);
    if (!conv) return res.status(404).json({ error: "conversation not found" });
    // Shape the response as the `ConversationDetail` the web client expects:
    // `messages[]` (mapped from the parsed `turns`) + id/agent/channel. Without
    // this the client's `detail.messages.filter(...)` throws on every load.
    res.json({
      id: req.params.id,
      agent_slug: req.params.slug,
      channel: conv.fm?.channel,
      messages: (conv.turns || []).map(shapeConversationMessage),
      meta: conv.fm || {},
    });
  });

  api.delete("/projects/:pid/agents/:slug/conversations/:id", (req, res) => {
    const p = project(req, res);
    if (!p) return;
    if (!agentResolvable(p, req.params.slug))
      return res.status(404).json({ error: "agent not found" });
    const ok = deleteConversation(p.storagePath, req.params.slug, req.params.id);
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
    res.json([...global, ...a2a]);
  });

  api.get("/projects/:pid/super-agent/threads/:channel/:id", (req, res) => {
    const p = project(req, res);
    if (!p) return;
    // a2a threads are keyed by participant-pair id, not a date — read them from
    // the project ledger; everything else is a global channel+date thread.
    const thread = req.params.channel === "a2a"
      ? readProjectA2AThread(p.storagePath, req.params.id)
      : readGlobalThread({
          channel: req.params.channel,
          date: req.params.id,
          project: threadScope(p),
        });
    if (!thread) return res.status(404).json({ error: "thread not found" });
    res.json(thread);
  });

  api.delete("/projects/:pid/super-agent/threads/:channel/:id", (req, res) => {
    const p = project(req, res);
    if (!p) return;
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
    const { from, to, body, deliver = false, _depth = 0, requested_by = null, severity = null } = req.body || {};
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
    // A synthetic sender ({slug}) is enough: replyAsAgent only reads `from.slug`,
    // and the a2a log records the label. The RECIPIENT still has to exist, so a
    // typo'd or wrong-project target fails loudly instead of vanishing.
    const fromAgent = agents.find((a) => a.slug === from) || { slug: from, fields: {}, synthetic: true };
    const toAgent = agents.find((a) => a.slug === to);
    if (!toAgent)
      return res.status(404).json({
        error: `to agent "${to}" not found in project "${p.name}"`,
        project: p.name,
        available: agents.map((a) => a.slug),
        hint: "run `apx agent list --all` to see every agent and its project",
      });

    // Snapshot the prior conversation BEFORE we log the new message, so the
    // reply sees history without the turn it is answering.
    const history = deliver ? a2aPairHistory(p.storagePath, from, to, to) : [];

    const ts = nowIso();
    p.logMessage({
      agent_slug: from,
      channel: "a2a",
      direction: "out",
      author: from,
      body,
      meta: { to, depth: _depth, ...sevMeta, ...(requested_by ? { requested_by } : {}) },
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
        from, depth: _depth, ...sevMeta,
        ...(ownerNotified ? { owner_notified: true } : {}),
        ...(requested_by ? { requested_by } : {}),
      },
      ts,
    });

    // An agent that inherits still replies: replyAsAgent resolves the router
    // default for it. `deliver` is the only gate here.
    let reply = null;
    if (deliver) {
      try {
        const result = await replyAsAgent({
          projectPath: p.path,
          toAgent,
          fromAgent,
          body,
          config: p.config || config,
          history,
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
            model: result.model,
            usage: result.usage,
          },
        });
        p.logMessage({
          agent_slug: from,
          channel: "a2a",
          direction: "in",
          author: to,
          body: result.text,
          meta: { from: to, depth: _depth + 1 },
        });
        reply = { text: result.text, usage: result.usage };
      } catch (e) {
        reply = { error: e.message };
      }
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
