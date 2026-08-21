// Routine output delivery — where a run's final text actually GOES.
//
// Until this file existed, a routine's answer was written to the ledger and
// nowhere else. Reaching a human was left to two workarounds, and both fail
// quietly:
//
//   1. a `apx telegram send "$APX_LLM_OUTPUT"` post_command — shell quoting,
//      a 32k env truncation, and a sink that only exists if you remember it;
//   2. a paragraph in the prompt asking the model to call send_telegram. The
//      bundled secretary profile still spells this out in full ("if you do not
//      call the tool, you receive nothing at all") because there was no other
//      way — and the one morning the model skips it, the symptom is silence.
//
// `deliver_to` makes delivery a property of the ROUTINE instead of a thing the
// prompt has to beg for: the runner takes the final text and hands it to one
// adapter per configured channel. Adding a channel is one entry in
// DELIVERY_ADAPTERS and nothing else — the resolution, the double-send guard
// and the run record are shared.
//
// A channel only belongs here when something actually READS what the adapter
// writes. `deck` is deliberately absent for that reason: writing to a surface
// nobody reads is a delivery that reports success and reaches no one.
import { appendGlobalMessage } from "#core/stores/messages.js";
import { CHANNELS } from "#core/constants/channels.js";
import { SUPERAGENT_ACTOR_ID, resolveAgentName } from "#core/identity/index.js";
import { TOOLS } from "#core/agent/tools/names.js";

/** `deliver_to: ["profile"]` — take the channels from the active agent profile. */
export const PROFILE_DELIVERY = "profile";

/** `deliver_to: ["none"]` — say out loud that this routine delivers nowhere. */
export const NO_DELIVERY = "none";

/**
 * Write the text into a global channel ledger. That is the whole of "delivery"
 * for a surface APX owns: appendGlobalMessage announces the row on the message
 * bus, so a panel with the thread open sees it arrive, and one that is closed
 * finds it in the thread list afterwards.
 *
 * `project_id` is what files the row under the right project (rowBelongsTo in
 * core/stores/messages.js) — an unstamped row lands in the default workspace,
 * which is not where the routine ran.
 */
function ledgerAdapter(channel) {
  return {
    id: channel,
    async deliver(ctx, { routine, text }) {
      appendGlobalMessage({
        channel,
        direction: "out",
        type: "agent",
        actor_id: SUPERAGENT_ACTOR_ID,
        actor_kind: "superagent",
        agent_slug: SUPERAGENT_ACTOR_ID,
        author: resolveAgentName(ctx?.globalConfig || {}),
        body: text,
        meta: {
          project_id: ctx?.project?.id ?? null,
          routine: routine.name,
          routine_id: routine.id || "",
          via: "routine_delivery",
        },
      });
      return { note: `written to the ${channel} thread` };
    },
  };
}

export const DELIVERY_ADAPTERS = Object.freeze({
  [CHANNELS.TELEGRAM]: {
    id: CHANNELS.TELEGRAM,
    // The tool that would produce the same message from inside the loop. The
    // runner suppresses it for the run, the way it already suppresses the tool
    // an equivalent post_command would duplicate.
    overlapTools: [TOOLS.SEND_TELEGRAM],
    async deliver(ctx, { routine, text }) {
      const tg = ctx?.plugins?.get?.("telegram");
      if (!tg?.send) throw new Error("telegram plugin not loaded");
      await tg.send({
        text,
        meta: { routine: routine.name, routine_id: routine.id || "", via: "routine_delivery" },
      });
      return { note: "sent to telegram" };
    },
  },
  [CHANNELS.WEB]: ledgerAdapter(CHANNELS.WEB),
});

/** The channel ids `deliver_to` accepts, for help text and validation. */
export function deliveryChannelIds() {
  return Object.keys(DELIVERY_ADAPTERS);
}

/**
 * A `deliver_to` value as a clean list, or null for "the routine said nothing".
 *
 * null and [] are DIFFERENT on purpose, and the difference is the one this repo
 * has already been bitten by once (see allowed_tools in stores/routines.js):
 * null means "no opinion, fall through to the default", [] means "deliver
 * nowhere" and stops the fallthrough. So the store must persist an absent
 * deliver_to as null and never as [].
 */
export function normalizeDeliverTo(value) {
  if (typeof value === "string") {
    const parts = value.split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
    return parts.length ? [...new Set(parts)] : [];
  }
  if (!Array.isArray(value)) return null;
  return [...new Set(
    value.filter((v) => typeof v === "string").map((s) => s.trim().toLowerCase()).filter(Boolean),
  )];
}

/** The channels an agent profile wants routine output on, if it says. */
function profileChannels(profileConfig) {
  const explicit = normalizeDeliverTo(profileConfig?.routine_delivery);
  if (explicit && explicit.length) return explicit;
  // Falling back to primary_channel is deliberate but NOT automatic: it only
  // applies to a routine that asked for "profile". primary_channel answers
  // "where do unrequested messages go", which is the same question for a
  // routine that has opted into being delivered, and a different one for a
  // routine that has not opted in at all.
  const primary = normalizeDeliverTo(profileConfig?.primary_channel);
  return primary && primary.length ? primary : [];
}

/**
 * Where this run's output goes.
 *
 * Order: the routine's own `deliver_to`, then the deployment default
 * (`config.routines.deliver_to`), then nowhere. "Nowhere" is the default on
 * purpose — every routine that existed before this feature keeps behaving
 * exactly as it did, and delivery is something you turn on.
 *
 * @returns {{channels: string[], unknown: string[], source: string}}
 *   `unknown` carries names that match no adapter so the caller can SAY so
 *   rather than silently delivering to fewer places than asked.
 */
export function resolveDeliveryChannels(routine, { profileConfig, globalConfig } = {}) {
  let source = "routine";
  let want = normalizeDeliverTo(routine?.deliver_to);
  if (want === null) {
    source = "config";
    want = normalizeDeliverTo(globalConfig?.routines?.deliver_to);
  }
  if (want === null) return { channels: [], unknown: [], source: "none" };
  if (want.includes(NO_DELIVERY)) return { channels: [], unknown: [], source: "off" };

  const expanded = [];
  for (const id of want) {
    if (id === PROFILE_DELIVERY) {
      source = "profile";
      expanded.push(...profileChannels(profileConfig));
    } else {
      expanded.push(id);
    }
  }
  const seen = new Set();
  const channels = [];
  const unknown = [];
  for (const id of expanded) {
    if (seen.has(id)) continue;
    seen.add(id);
    if (DELIVERY_ADAPTERS[id]) channels.push(id);
    else if (id !== NO_DELIVERY) unknown.push(id);
  }
  return { channels, unknown, source: channels.length || unknown.length ? source : "none" };
}

/**
 * Tools that would duplicate a configured delivery, to be suppressed for the
 * run. Same contract as computeSuppressedTools for post_commands: the sink owns
 * the message, so the loop must not send it too.
 */
export function deliverySuppressedTools(channels) {
  const out = new Set();
  for (const id of channels || []) {
    for (const t of DELIVERY_ADAPTERS[id]?.overlapTools || []) out.add(t);
  }
  return [...out];
}

/**
 * What this run PRODUCED, in the order the handlers put it: an agent's final
 * text, a telegram routine's body, a shell routine's stdout.
 *
 * Delivery needs one answer to "what would a person read", and every handler
 * spells it differently — reading `reply` only meant a `kind: shell` routine
 * had output, a configured channel, and nothing to deliver.
 */
export function routineOutputText(result) {
  for (const key of ["reply", "text", "stdout"]) {
    const v = result?.[key];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return "";
}

/**
 * Channels whose message is ALREADY on its way, so delivering would send it
 * twice. Three ways that happens, and all three are real:
 *
 *   • `handler`       — the run IS the send. A `kind: telegram` routine posts
 *                       spec.text itself; delivering the same text after it is
 *                       the same message twice.
 *   • `post_commands` — an `apx telegram send "$APX_LLM_OUTPUT"` sink. The user
 *                       wired the pipe by hand; the pipe wins.
 *   • `agent`         — the loop called the tool anyway. Suppression should
 *                       have removed it, so this is the backstop, not the plan:
 *                       a rename or an override that slips past suppression
 *                       must not turn into a duplicate message.
 *
 * @returns {Array<{channel: string, reason: string}>}
 */
export function alreadyServedChannels({ routine, channels, postSinks, trace }) {
  const calledOk = new Set(
    (Array.isArray(trace) ? trace : [])
      .filter((t) => t?.tool && !t?.result?.error)
      .map((t) => t.tool),
  );
  const served = [];
  for (const id of channels || []) {
    const tools = DELIVERY_ADAPTERS[id]?.overlapTools || [];
    if (id === CHANNELS.TELEGRAM && routine?.kind === CHANNELS.TELEGRAM) {
      served.push({ channel: id, reason: "handler" });
    } else if (tools.some((t) => (postSinks || []).includes(t))) {
      served.push({ channel: id, reason: "post_commands" });
    } else if (tools.some((t) => calledOk.has(t))) {
      served.push({ channel: id, reason: "agent" });
    }
  }
  return served;
}

/**
 * Deliver `text` to each channel. Never throws: one channel being down must not
 * lose the other channels' delivery, and it must not turn a run that did its
 * work into a run that reports as a crash. What it does instead is RECORD the
 * failure per channel, so the caller can name it — the whole point of this
 * feature is that a message nobody received stops looking like success.
 *
 * @returns {Array<{channel, status, note?, error?}>}
 */
export async function deliverRoutineOutput(ctx, { routine, channels, text }) {
  const out = [];
  for (const id of channels || []) {
    const adapter = DELIVERY_ADAPTERS[id];
    if (!adapter) {
      out.push({ channel: id, status: "error", error: `unknown delivery channel: ${id}` });
      continue;
    }
    try {
      const r = await adapter.deliver(ctx, { routine, text });
      out.push({ channel: id, status: "ok", ...(r?.note ? { note: r.note } : {}) });
    } catch (e) {
      out.push({ channel: id, status: "error", error: e?.message || String(e) });
    }
  }
  return out;
}
