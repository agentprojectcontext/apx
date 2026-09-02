// Stopping a turn that is already running.
//
// Every other surface could already do this. Telegram has kept one
// AbortController per chat since the beginning — a new message aborts the
// running turn ("no, stop, do this instead"), and the desktop capsule has its
// own cancel. The web panel had neither: its Stop button aborted the browser's
// fetch and nothing else, so the run kept going, kept calling tools, and
// persisted its answer to a thread nobody was watching. Sending a message
// mid-turn could only queue behind it.
//
// The reason the socket closing cannot itself stop the run is deliberate: a
// refresh, or a second tab, has to be able to catch up on a turn in progress
// (see active-turns.js). So cancelling has to be said out loud, which is this
// route.
//
// Addressed the way the client already addresses the thread, because that is
// the identity it has on hand:
//   project agent  → { conversation_id }
//   super-agent    → { channel }   (its thread IS the channel; see
//                                   superAgentTurnKey)
//   group room     → { channel: "group", thread_id }
//
// The third form is the general one: a channel that holds MANY threads needs to
// say which. A group is the case that has it — one project runs any number of
// rooms at once, so `channel` alone would stop whichever of them the map
// happened to hold. A cascade is also the turn most worth stopping, since a
// single owner line can fan out into ten full tool loops.
import { asyncRoute } from "./shared.js";
import { abortActiveTurn, convTurnKey, superAgentTurnKey, threadTurnKey } from "../active-turns.js";

export function register(api, { project }) {
  api.post("/projects/:pid/turns/abort", asyncRoute(async (req, res) => {
    const p = project(req, res);
    if (!p) return;
    const { conversation_id: conversationId, channel, thread_id: threadId } = req.body || {};
    if (!conversationId && !channel) {
      return res.status(400).json({ error: "conversation_id or channel required" });
    }
    const key = conversationId
      ? convTurnKey(p.id, conversationId)
      : threadId
      ? threadTurnKey(p.id, channel, threadId)
      : superAgentTurnKey(p.id, channel);
    // `false` is not an error: the turn may have finished a moment before the
    // click landed, and a client that interrupts by sending should carry on and
    // send either way.
    res.json({ ok: true, aborted: abortActiveTurn(key) });
  }));
}
