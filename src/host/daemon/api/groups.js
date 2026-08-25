// Group chat = owner + N project agents in one room. A group is a THREAD on the
// message ledger (channel "group"), so it lists and opens through the same
// endpoints as a2a threads: `GET /super-agent/threads` (list, in conversations.js)
// and `GET /super-agent/threads/group/:id` (detail). This router owns only what
// those don't: creating a room, adding a participant, and running the owner's
// turn as a streamed mention-cascade.
//
//   POST /projects/:pid/groups                     create { title, participants } → { id }
//   POST /projects/:pid/groups/:gid/participants   add an agent { slug }
//   POST /projects/:pid/groups/:gid/message/stream owner speaks → NDJSON cascade
import { readAgents } from "#core/apc/parser.js";
import {
  createGroupThread, addGroupParticipant, removeGroupParticipant, readProjectGroupThread, truncateGroupThread,
} from "#core/stores/messages.js";
import { runGroupTurn } from "#core/agent/group/run-group-turn.js";
import { readTurnAttachments } from "./media.js";
import { asyncRoute } from "./shared.js";

const KEEPALIVE_MS = 15000;

// Best-effort owner display name for the transcript: the Telegram roster entry
// tagged role "owner", else a neutral fallback.
function ownerName(config) {
  const owner = (config?.telegram?.contacts || []).find((c) => c.role === "owner");
  return owner?.name || "Owner";
}

export function register(api, { projects, project, config, plugins, registries }) {
  api.post("/projects/:pid/groups", (req, res) => {
    const p = project(req, res);
    if (!p) return;
    const { title, participants } = req.body || {};
    const known = new Set(readAgents(p.path).map((a) => a.slug));
    const slugs = (Array.isArray(participants) ? participants : []).filter((s) => known.has(s));
    if (slugs.length < 1) return res.status(400).json({ error: "at least one existing agent required" });
    try {
      const id = createGroupThread(p.logMessage, { title: title || null, participants: slugs });
      try { projects.rebuild(p.id); } catch { /* best-effort */ }
      res.status(201).json({ id, channel: "group", title: title || slugs.join(" · "), participants: slugs });
    } catch (e) {
      res.status(400).json({ error: e.message });
    }
  });

  api.post("/projects/:pid/groups/:gid/participants", (req, res) => {
    const p = project(req, res);
    if (!p) return;
    const { slug } = req.body || {};
    if (!readAgents(p.path).some((a) => a.slug === slug))
      return res.status(404).json({ error: "agent not found" });
    const thread = readProjectGroupThread(p.storagePath, req.params.gid);
    if (!thread) return res.status(404).json({ error: "group not found" });
    if (!thread.participants.includes(slug)) {
      addGroupParticipant(p.logMessage, req.params.gid, [...thread.participants, slug], slug);
      try { projects.rebuild(p.id); } catch { /* best-effort */ }
    }
    res.json({ id: req.params.gid, participants: [...new Set([...thread.participants, slug])] });
  });

  // Remove an agent from a room. Records a "… salió del chat" notice and drops
  // them from the roster, so the cascade no longer seeds or lists them.
  api.delete("/projects/:pid/groups/:gid/participants/:slug", (req, res) => {
    const p = project(req, res);
    if (!p) return;
    const thread = readProjectGroupThread(p.storagePath, req.params.gid);
    if (!thread) return res.status(404).json({ error: "group not found" });
    const next = thread.participants.filter((s) => s !== req.params.slug);
    if (next.length !== thread.participants.length) {
      removeGroupParticipant(p.logMessage, req.params.gid, req.params.slug, next);
      try { projects.rebuild(p.id); } catch { /* best-effort */ }
    }
    res.json({ id: req.params.gid, participants: next });
  });

  // Rewind a group so a regenerate/edit can overwrite everything after a point.
  // `keep_visible` = how many display messages (owner + agent turns) to keep.
  api.post("/projects/:pid/groups/:gid/truncate", (req, res) => {
    const p = project(req, res);
    if (!p) return;
    const keepVisible = Number(req.body?.keep_visible);
    if (!Number.isInteger(keepVisible) || keepVisible < 0)
      return res.status(400).json({ error: "keep_visible must be a non-negative integer" });
    if (!readProjectGroupThread(p.storagePath, req.params.gid))
      return res.status(404).json({ error: "group not found" });
    const out = truncateGroupThread(p.storagePath, req.params.gid, keepVisible);
    try { projects.rebuild(p.id); } catch { /* best-effort */ }
    res.json({ ok: true, ...out });
  });

  // The owner speaks; the room answers as an NDJSON cascade of speaker events.
  // `rerun: true` re-runs against the existing last owner message (regenerate).
  // Optional `from` resumes the cascade at that speaker so earlier replies
  // this turn stay put; without it the whole room-answer is re-run.
  api.post("/projects/:pid/groups/:gid/message/stream", asyncRoute(async (req, res) => {
    const p = project(req, res);
    if (!p) return;
    const { prompt, rerun, attachments, from, reason } = req.body || {};
    // Files the composer uploaded to ~/.apx/media: images ride on each speaker's
    // turn (vision), and a marker naming each file is folded into the prompt so a
    // photo with no caption is still a turn and a non-vision agent is told a file
    // arrived and where it lives. Same handling as the 1:1 chat.
    const turnFiles = rerun ? { attachments: [], markers: [], media: null } : readTurnAttachments(attachments);
    const turnPrompt = [...turnFiles.markers, prompt].filter(Boolean).join(" ");
    if (!rerun && !turnPrompt.trim()) return res.status(400).json({ error: "prompt required" });
    if (!readProjectGroupThread(p.storagePath, req.params.gid)) return res.status(404).json({ error: "group not found" });

    res.setHeader("content-type", "application/x-ndjson; charset=utf-8");
    res.setHeader("cache-control", "no-cache, no-transform");
    res.setHeader("x-accel-buffering", "no");
    res.flushHeaders?.();

    let lastWriteAt = Date.now();
    const send = (event) => { lastWriteAt = Date.now(); res.write(JSON.stringify(event) + "\n"); };
    const keepalive = setInterval(() => {
      if (Date.now() - lastWriteAt < KEEPALIVE_MS) return;
      lastWriteAt = Date.now();
      try { res.write("\n"); } catch { /* socket gone */ }
    }, KEEPALIVE_MS);
    keepalive.unref?.();
    res.on("close", () => clearInterval(keepalive));

    try {
      await runGroupTurn({
        p, gid: req.params.gid, text: turnPrompt, rerun: !!rerun,
        from: typeof from === "string" && from.trim() ? from.trim() : null,
        reason: typeof reason === "string" && reason.trim() ? reason.trim() : null,
        attachments: turnFiles.attachments, media: turnFiles.media,
        ownerName: ownerName(config), config, projects, plugins, registries,
        onEvent: send,
      });
      try { projects.rebuild(p.id); } catch { /* best-effort */ }
      send({ type: "final" });
      clearInterval(keepalive);
      res.end();
    } catch (e) {
      send({ type: "error", error: e.message });
      clearInterval(keepalive);
      res.end();
    }
  }));
}
