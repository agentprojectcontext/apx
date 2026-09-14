// One turn, told as a story every surface can follow — whatever channel it
// arrived on.
//
// WHY THIS IS ONE FUNCTION AND NOT FIVE COPIES. A turn has a beginning, a
// middle and an end, and a surface that is not the one that started it needs
// all three: `start` is what makes a thread say somebody is working before a
// single token exists, the `event`/`delta` frames are what make a multi-step
// turn look like work rather than one paragraph, and `final` is what CLOSES the
// follower's bubble — without it the bubble stays pending forever, the silent
// catch-up refuses to run (it skips while a turn is in flight) and Stop sits on
// screen over a turn that ended minutes ago.
//
// That sequence was written out by hand in api/super-agent.js, api/groups.js,
// api/code.js, api/exec.js and api/conversations.js — five copies of the same
// five steps — and written NOWHERE for a turn that arrives on Telegram or
// WhatsApp. So the rule came out backwards: a turn was followable if an HTTP
// route happened to start it, and invisible if a person wrote to the bot.
//
// What Manu saw on 2026-09-14: Telegram showed "Escribiendo…" (that indicator
// is the channel's own, sent by sendChatAction) while the same conversation on
// the web sat dead. Refresh and the tools were all there, on disk, written as
// they happened — the ledger was never the problem. Nothing was pushing, and
// nothing was registered to catch up from, because `startActiveTurn` had no
// caller outside the API.
//
// THE WORK IS THE SAME; ONLY THE OUTPUT DIFFERS. A channel still decides what
// it sends back to its own people — Telegram holds the intermediate notes and
// sends prose, the web streams tokens — and that stays in the channel. What
// stops being the channel's business is whether the REST of the system can see
// the turn at all.
//
// Lives in host/ and not in core/ because it is pure adapter: the in-memory
// registry and the WS hub are both daemon runtime (rule 8). Core reaches it the
// way it reaches every other daemon-only capability — through an injected hook,
// the same way the Telegram plugin already hands core its `_send`.
import {
  startActiveTurn,
  appendActiveTurn,
  recordActiveTurnEvent,
  isVisibleTurnEvent,
  endActiveTurn,
} from "./active-turns.js";
import { broadcastTurn } from "./events-ws.js";

/**
 * Register a turn and return the handles that narrate it.
 *
 * @param {object}  o
 * @param {string}  o.key           registry key — build it with one of active-turns'
 *                                  key helpers, so whoever reads looks under the
 *                                  same name the writer used.
 * @param {number|string|null} o.projectId
 * @param {string}  o.channel
 * @param {string|null} o.threadId  which thread on that channel; a reader matches on it.
 * @param {string|null} o.agentSlug who is answering, when that is known up front.
 * @param {string|null} o.conversationId
 * @param {string|null} o.title     one line for a panel listing live work.
 * @param {string|null} o.prompt    what was asked, kept so a restart that has to
 *                                  cut this off can hand it to the next daemon.
 * @param {string|null} o.model
 * @param {string|null} o.surface   which kind of caller this is, for the resumer.
 * @param {(() => void)|null} o.abort  what POST /turns/abort and Stop pull.
 *
 * @returns {{id: string, active: object, onEvent: (ev: object) => void,
 *            onToken: (chunk: string) => void, frame: Function,
 *            final: Function, error: Function, aborted: Function, end: Function}}
 */
export function trackChannelTurn({
  key,
  projectId = null,
  channel,
  threadId = null,
  agentSlug = null,
  conversationId = null,
  title = null,
  prompt = null,
  model = null,
  surface = null,
  abort = null,
} = {}) {
  const active = startActiveTurn(key, {
    project_id: projectId,
    channel,
    thread_id: threadId,
    agent_slug: agentSlug,
    model,
    ...(title ? { title } : {}),
    ...(prompt ? { prompt } : {}),
    ...(surface ? { surface } : {}),
    ...(abort ? { abort } : {}),
  });

  const frame = (phase, extra = {}) => broadcastTurn({
    phase,
    project_id: projectId,
    agent_slug: agentSlug,
    conversation_id: conversationId,
    channel,
    thread_id: threadId,
    turn_id: active.id,
    ...extra,
  });

  // Recorded for whoever opens the thread mid-turn, pushed for whoever is
  // already watching it. The two have to stay in step: when the record kept the
  // tools and the feed carried only tokens, a follower watched a multi-step turn
  // collapse into a single paragraph.
  const onEvent = (ev) => {
    recordActiveTurnEvent(active.id, ev);
    if (isVisibleTurnEvent(ev)) frame("event", { event: ev });
  };

  const onToken = (chunk) => {
    appendActiveTurn(active.id, chunk);
    frame("delta", { delta: chunk });
  };

  // Announced before a single token exists — this is the frame that makes a
  // thread say somebody is working.
  frame("start");

  return {
    id: active.id,
    active,
    frame,
    onEvent,
    onToken,
    /** It answered. `result` is echoed to followers as the closing bubble. */
    final: (result = {}) => frame("final", { result }),
    /** It broke. Said plainly rather than left as an open bubble. */
    error: (message) => frame("error", { error: message }),
    /** Somebody stopped it. Carries whatever it had managed to say, which the
     *  registry holds and the failure path files nowhere else. */
    aborted: (text) => frame("aborted", { result: { text: text ?? active.text ?? "" } }),
    end: () => endActiveTurn(active.id),
  };
}
