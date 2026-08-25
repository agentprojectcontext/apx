// The one-line bubbles the desktop / Android pets show.
//
// WHY HERE, NOT IN EACH CLIENT. Desktop Electron and the Android overlay both
// subscribe to the same /api/events/ws feed. When each one invented its own
// filter they drifted: both treated the owner's own send (`direction: "in"`)
// as news, and skipped the thing the pet is for — an agent actually launching
// its closing message on Telegram, a group, or A2A. One function, attached to
// the frame as `notifications: string[]`, is what both surfaces render.
//
// SIGNAL, NOT DATA. A line names who spoke and where. It never carries the
// body. Delivery rows may also bring a bounded `notify` headline the writer
// already chose (≤100 chars) — still a notice, not the message.

const AGENT_FINAL_CHANNELS = new Set(["telegram", "group", "a2a"]);
const DELIVERY_VIA = new Set(["routine_delivery", "mobility_delivery"]);

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
 * @returns {string[]}       one bubble per distinct agent×channel (plus any
 *                           delivery headlines), in a stable order
 */
export function mascotNotificationsFromEvents(events) {
  const lines = [];
  const list = Array.isArray(events) ? events : [];

  for (const event of list) {
    if (event?.via === "mobility_delivery") {
      const notice = String(event.notify || "").trim();
      if (notice) lines.push(notice);
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
    lines.push(notice ? `${agent}: ${notice}` : `${agent} te dejó un mensaje`);
  }

  const finals = new Map();
  for (const event of list) {
    if (!isAgentFinalEvent(event)) continue;
    const agent = speakerName(event);
    finals.set(`${event.channel}|${agent}`, { channel: event.channel, agent });
  }
  for (const { channel, agent } of finals.values()) {
    lines.push(`${agent} respondió en ${channelLabel(channel)}`);
  }

  return lines;
}
