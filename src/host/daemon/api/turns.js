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
//   code session   → { code_session_id }
//
// The third form is the general one: a channel that holds MANY threads needs to
// say which. A group is the case that has it — one project runs any number of
// rooms at once, so `channel` alone would stop whichever of them the map
// happened to hold. A cascade is also the turn most worth stopping, since a
// single owner line can fan out into ten full tool loops.
//
// A code session is the one thread that is NOT addressed by channel at all: the
// same session is driven from the panel (`web_code`) and from `apx exec --code`
// (`code`), and Stop in the panel has to reach the turn either of them started.
// So it names the session, which is the only identity both surfaces share.
//
// `{ channel, thread_id }` is ALSO what a tab sends for Roby's own chat when it
// is following the turn instead of having sent it (it only knows the thread it
// is looking at). That turn is keyed by channel, not by thread, so asking for
// the thread key alone answered "nothing to stop" and the button sat over a
// run that kept going. liveThreadTurnKey asks the register which of the two
// shapes the live turn on that thread actually has.
import { asyncRoute } from "./shared.js";
import { abortActiveTurn, codeTurnKey, convTurnKey, liveThreadTurnKey, superAgentTurnKey } from "../active-turns.js";

export function register(api, { project }) {
  api.post("/projects/:pid/turns/abort", asyncRoute(async (req, res) => {
    const p = project(req, res);
    if (!p) return;
    const {
      conversation_id: conversationId,
      channel,
      thread_id: threadId,
      code_session_id: codeSessionId,
    } = req.body || {};
    if (!conversationId && !channel && !codeSessionId) {
      return res.status(400).json({ error: "conversation_id, channel or code_session_id required" });
    }
    const key = codeSessionId
      ? codeTurnKey(p.id, codeSessionId)
      : conversationId
      ? convTurnKey(p.id, conversationId)
      : threadId
      ? liveThreadTurnKey(p.id, channel, threadId)
      : superAgentTurnKey(p.id, channel);
    // `false` is not an error: the turn may have finished a moment before the
    // click landed, and a client that interrupts by sending should carry on and
    // send either way.
    res.json({ ok: true, aborted: !!key && abortActiveTurn(key) });
  }));
}
