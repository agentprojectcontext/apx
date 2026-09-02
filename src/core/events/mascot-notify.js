// The one-line bubbles the desktop / Android pets show.
//
// WHY HERE, NOT IN EACH CLIENT. Desktop Electron and the Android overlay both
// subscribe to the same /api/events/ws feed. When each one invented its own
// filter they drifted: both treated the owner's own send (`direction: "in"`)
// as news, and skipped the thing the pet is for — an agent actually launching
// its closing message on Telegram, a group, or A2A. One function, attached to
// the frame as `notifications: string[]`, is what both surfaces render.
//
// SIGNAL, NOT DATA. A line names who spoke and where — on A2A, who spoke to
// whom. It never carries the body. Delivery rows may also bring a bounded
// `notify` headline the writer already chose (≤100 chars) — still a notice,
// not the message.
//
// EACH LINE CARRIES ITS CHANNEL. The text alone leaves a client with nothing to
// filter on: the phone has Telegram installed ON it, so an APX bubble about a
// Telegram reply is the same news twice, while the trip notice on the same
// phone is the only way that news arrives at all. So a notice is `{ text,
// channel }` and the surface decides which channels may ring it — the web has
// done that per device since lib/channels.ts; the APK could not, because what
// reached it was a bare string.

import { SUPERAGENT_ACTOR_ID } from "../constants/actors.js";
import { resolveAgentName } from "../identity/self.js";

const AGENT_FINAL_CHANNELS = new Set(["telegram", "group", "a2a"]);
const DELIVERY_VIA = new Set(["routine_delivery", "mobility_delivery"]);

/**
 * The channels a BUBBLE can be about — not the channels APX speaks on.
 *
 * Five, and the list is closed by construction: three are agent finals
 * (telegram / group / a2a) and two are deliveries that arrive with their own
 * headline. A routine delivery is filed on `web` and a mobility one on
 * telegram, but neither is news *about that channel* — "an errand on the way
 * home" is not a Telegram message, and muting Telegram must not silence the
 * car. So a delivery is tagged by what it IS, the same rule the `log` channel
 * settled on core-side.
 *
 * A client shows this list as the choice; nothing else can ever ring.
 */
export const NOTICE_CHANNELS = ["telegram", "group", "a2a", "routine", "mobility"];

function channelLabel(channel) {
  if (channel === "telegram") return "Telegram";
  if (channel === "group") return "Grupo";
  if (channel === "a2a") return "A2A";
  if (!channel) return "un canal";
  return channel.charAt(0).toUpperCase() + channel.slice(1);
}

function speakerName(event) {
  const author = String(event?.author || "").trim();
  if (author && author !== "user" && author !== "owner" && !author.startsWith("@")) return author;
  return String(event?.agent_slug || "").trim() || "agente";
}

/** A participant's name as a sentence should carry it.
 *
 *  The super-agent is filed on the ledger under its ACTOR ID, so a bubble that
 *  printed the stored name said "a Super_agent" about the agent the owner calls
 *  Roby. An id is what the ledger needs to keep one thread per correspondent;
 *  it is not what a sentence about that correspondent says. Everyone else keeps
 *  the name they were addressed by — an a2a address is a slug written lowercase
 *  (`magui`), and "de magui a roby" reads as a log line rather than as news, so
 *  it gets a capital. A name that already carries its own casing (`Roby`,
 *  `iOS-bot`) is left exactly as its author wrote it. */
function peerLabel(name) {
  const n = String(name || "").trim();
  if (n === SUPERAGENT_ACTOR_ID) return resolveAgentName();
  if (!n || n !== n.toLowerCase()) return n;
  return n.charAt(0).toUpperCase() + n.slice(1);
}

/** An agent's closing message on Telegram / group / A2A — not a stream chunk,
 *  not a tool row, not the owner's own send, not a delivery that already has
 *  its own headline. */
export function isAgentFinalEvent(event) {
  if (!event || event.direction !== "out") return false;
  if (event.type && event.type !== "agent") return false;
  if (!AGENT_FINAL_CHANNELS.has(event.channel)) return false;
  if (event.streamed === true) return false;
  if (DELIVERY_VIA.has(event.via)) return false;
  return true;
}

/**
 * @param {object[]} events  the public events already on a "messages" frame
 * @returns {{text: string, channel: string}[]}
 *          one notice per distinct agent×channel (plus any delivery
 *          headlines), in a stable order, each tagged with the channel a
 *          client filters on. See NOTICE_CHANNELS.
 */
export function mascotNoticesFromEvents(events) {
  const notices = [];
  const list = Array.isArray(events) ? events : [];

  for (const event of list) {
    if (event?.via === "mobility_delivery") {
      const notice = String(event.notify || "").trim();
      if (notice) notices.push({ text: notice, channel: "mobility" });
    }
  }

  const routineByAgent = new Map();
  for (const event of list) {
    if (!event || event.via !== "routine_delivery" || event.channel !== "web") continue;
    if (!event.agent_slug || event.agent_slug === "super_agent") continue;
    routineByAgent.set(event.agent_slug, event.notify || routineByAgent.get(event.agent_slug) || "");
  }
  for (const [agent, notify] of routineByAgent) {
    const notice = String(notify || "").trim();
    notices.push({
      text: notice ? `${agent}: ${notice}` : `${agent} te dejó un mensaje`,
      channel: "routine",
    });
  }

  const finals = new Map();
  for (const event of list) {
    if (!isAgentFinalEvent(event)) continue;
    const agent = speakerName(event);
    // On A2A the pair IS the news. "martin respondió en A2A" names a channel the
    // owner never opened and leaves out the only thing he wants to know — who
    // reached who. The counterpart rides the event for exactly this line; when
    // it is missing (an older row, a writer that set no `to`) the bubble falls
    // back to naming the channel rather than inventing a recipient.
    const to = event.channel === "a2a" ? String(event.to || "").trim() : "";
    finals.set(`${event.channel}|${agent}|${to}`, { channel: event.channel, agent, to });
  }
  for (const { channel, agent, to } of finals.values()) {
    notices.push({
      text: to
        ? `Nuevo mensaje de ${peerLabel(agent)} a ${peerLabel(to)}`
        : `${agent} respondió en ${channelLabel(channel)}`,
      channel,
    });
  }

  return notices;
}

/**
 * The same notices as bare lines.
 *
 * Still the frame's `notifications`, because an APK is installed software that
 * updates when its owner gets around to it: a phone carrying last month's build
 * reads this field and must keep working. Desktop reads it too — the pet there
 * has no per-channel question to answer, one screen showing everything is the
 * whole point of it.
 *
 * @returns {string[]}
 */
export function mascotNotificationsFromEvents(events) {
  return mascotNoticesFromEvents(events).map((notice) => notice.text);
}
