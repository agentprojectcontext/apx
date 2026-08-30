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
import fs from "node:fs";
import { appendGlobalMessage } from "#core/stores/messages.js";
import { CHANNELS } from "#core/constants/channels.js";
import { SUPERAGENT_ACTOR_ID, resolveAgentName } from "#core/identity/index.js";
import { TOOLS } from "#core/agent/tools/names.js";
import { canNudge, recordNudge } from "#core/nudge/index.js";
import { conversationPath, startConversation, appendTurn } from "#core/stores/conversations.js";
import { callEngine } from "#core/engines/index.js";
import { attachmentsMeta } from "#core/stores/media-archive.js";

/**
 * A project agent's ONE persistent web chat with the owner. A routine run by a
 * non-Roby agent posts its message here (a fixed thread reused across runs)
 * instead of into the super-agent's dated web channel — so golf-coach keeps a
 * single ongoing conversation you can reply to, the way Manu asked for. See
 * `deliverToAgentWebChat`.
 */
export const AGENT_WEB_CHAT_ID = "web-main";

/** `deliver_to: ["profile"]` — take the channels from the active agent profile. */
export const PROFILE_DELIVERY = "profile";

/** `deliver_to: ["none"]` — say out loud that this routine delivers nowhere. */
export const NO_DELIVERY = "none";

/**
 * The token a routine writes INSTEAD of a message when it decides it has
 * nothing worth interrupting for.
 *
 * The watch and a2a-sweep prompts have promised this since they were written —
 * "if you decide to stay quiet, say so in your reply and it goes nowhere" — and
 * nothing in the code ever kept the promise. `routineOutputText` returns any
 * non-empty reply, so the sentence the model wrote to explain ITSELF was
 * delivered as if it were the news: "Me mantengo en silencio. La señal de
 * inactividad de 8 días en flit es de severidad baja…" arrived on Manu's phone
 * twice on 2026-08-27, and each one was charged against the interruption budget
 * — two of that day's three unscheduled slots spent by a routine saying it had
 * nothing to say. The budget that exists to protect real messages was being
 * drained by abstentions.
 *
 * A decision is not a message, so it gets a token rather than a sentence. The
 * reasoning after the marker still matters — it just belongs in the run log and
 * the routine's memory, which is where the prompt already asks for it.
 */
export const ABSTAIN_MARKER = "NO_MESSAGE";

const ABSTAIN_RE = new RegExp(`^${ABSTAIN_MARKER}\\b[\\s:.,\u2013\u2014-]*(.*)$`, "i");

/**
 * Read a routine's reply as an abstention, or null if it is a real message.
 *
 * Deliberately marker-only: no prose detection. A regex hunting for "silencio"
 * or "staying quiet" across two languages would both miss abstentions the model
 * phrased differently AND swallow a genuine message that happens to mention
 * keeping quiet — and a delivery that eats real news is worse than the bug it
 * would be fixing. The marker has to be the first thing on the first line;
 * anything after it is kept as the reason.
 *
 * @returns {{reason: string}|null}
 */
export function readAbstention(text) {
  const raw = typeof text === "string" ? text.trim() : "";
  if (!raw) return null;
  const lines = raw.split(/\r?\n/);
  // A model that emphasises or fences the marker still means the marker. NOT
  // `_` — it is markdown emphasis everywhere except inside NO_MESSAGE itself.
  const first = lines[0].replace(/[`*#>]/g, "").trim();
  const m = ABSTAIN_RE.exec(first);
  if (!m) return null;
  return { reason: [m[1], ...lines.slice(1)].join("\n").trim() };
}

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
/** The `media` a delivered row carries, shaped for the thread viewer.
 *
 *  This used to name the skill's own file — `~/.apx/skills/<slug>/grip.png` —
 *  and the media endpoint serves nothing from outside ~/.apx/media, so every
 *  delivered image rendered as "attachment failed" no matter how correct the
 *  row was. `attachmentsMeta` archives the bytes first and records the copy. */
function mediaMeta(attachments) {
  return attachmentsMeta(attachments);
}

/**
 * Post a non-Roby agent's routine output into that agent's OWN persistent web
 * chat — a single reused thread (`AGENT_WEB_CHAT_ID`) attributed to the agent,
 * NOT the super-agent's dated web channel. This is the rule Manu set: "a routine
 * run by an agent that is not Roby creates its own chat with me on the web
 * channel" — golf-coach's tip lands in golf-coach's thread, and stays there to
 * be answered, run after run.
 */
function deliverToAgentWebChat(ctx, { routine, text, attachments, agent, abstained }) {
  const storagePath = ctx?.project?.storagePath;
  if (!storagePath) throw new Error("no project storagePath for the agent web chat");
  const author = agent.name || agent.slug;
  const file = conversationPath(storagePath, agent.slug, AGENT_WEB_CHAT_ID);
  if (!fs.existsSync(file)) {
    startConversation({
      storagePath,
      agentSlug: agent.slug,
      engine: agent.model || "",
      channel: CHANNELS.WEB,
      title: author,
      id: AGENT_WEB_CHAT_ID,
    });
  }
  // The thread the panel reopens. Left OPEN on purpose — this is a live chat the
  // owner replies in, not a closed run record. appendTurn announces it on the
  // message bus, so an open panel sees the tip arrive without a reload.
  appendTurn({
    filePath: file,
    role: "assistant",
    content: text,
    // Carry model AND usage, the same attribution turn-record.js writes — a
    // conversation reopened from the file renders "0 tok"/no model without it.
    meta: {
      agent: agent.slug,
      agent_name: author,
      ...(agent.model ? { model: agent.model } : {}),
      ...(agent.usage ? { usage: agent.usage } : {}),
      via: "routine_delivery",
      routine: routine.name,
      // The image belongs on the THREAD too, not only on the ledger row. This
      // file is what the panel reopens; without it the tip came back as text
      // and the picture it was built around was only in the inbox copy.
      ...mediaMeta(attachments),
    },
  });
  // The cross-channel ledger row, under the AGENT (search, RAG, the inbox) —
  // stamped web + agent, never the global super-agent web channel.
  ctx?.project?.logMessage?.({
    agent_slug: agent.slug,
    channel: CHANNELS.WEB,
    direction: "out",
    type: "agent",
    actor_id: agent.slug,
    actor_kind: "agent",
    author,
    body: text,
    meta: {
      routine: routine.name,
      routine_id: routine.id || "",
      via: "routine_delivery",
      conversation: AGENT_WEB_CHAT_ID,
      ...(abstained ? { abstained: true } : {}),
      // The one-line headline the event feed hands the desktop mascot.
      ...(agent.notify ? { notify: agent.notify } : {}),
      ...(agent.model ? { model: agent.model } : {}),
      ...(agent.usage ? { usage: agent.usage } : {}),
      ...mediaMeta(attachments),
    },
  });
  const n = (attachments || []).filter((a) => a && a.path).length;
  return { note: `posted to ${agent.slug}'s own web chat${n ? ` (+${n} image${n > 1 ? "s" : ""})` : ""}` };
}

function ledgerAdapter(channel) {
  return {
    id: channel,
    async deliver(ctx, { routine, text, attachments, agent, abstained }) {
      // A non-Roby agent's routine goes to ITS own chat, not the super-agent's
      // channel (the rule above). Only the super-agent's own routines — or a
      // channel with no agent identity — write the global channel thread.
      if (channel === CHANNELS.WEB && agent?.slug && agent.slug !== SUPERAGENT_ACTOR_ID) {
        return deliverToAgentWebChat(ctx, { routine, text, attachments, agent, abstained });
      }
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
          // A decision, not a message — so a reader (and any future UI) can
          // fold it away instead of showing it as something Roby said.
          ...(abstained ? { abstained: true } : {}),
          // Attribution when the caller carried it (the super-agent's own run —
          // see runner.js). Without it the delivered row renders "0 tok"/no model.
          ...(agent?.model ? { model: agent.model } : {}),
          ...(agent?.usage ? { usage: agent.usage } : {}),
          ...mediaMeta(attachments),
        },
      });
      const n = (attachments || []).filter((a) => a && a.path).length;
      if (abstained) return { note: `noted in the ${channel} thread (stayed quiet)` };
      return { note: `written to the ${channel} thread${n ? ` (+${n} image${n > 1 ? "s" : ""})` : ""}` };
    },
  };
}

/**
 * Roby tells Manu he has something waiting, on Telegram, in Roby's own words —
 * the second half of Manu's rule ("leave a delivery so Roby notifies me"), done
 * without the a2a-chat hack that used to clutter the inbox and leak the
 * `super_agent` slug into the UI.
 *
 * The gate is checked FIRST, so a delivery the interruption budget would hold
 * never spends a model turn composing a line nobody receives:
 *   • a priority/anchor delivery crosses the budget → Roby composes and sends now
 *     (this is what makes a priority tip arrive "de toque", not in 20 minutes);
 *   • an ordinary one is held when the budget says so — reported as `held` so the
 *     delivery queue shows it withheld rather than lost.
 *
 * Roby WRITES the line (never a canned string, per the model-authored rule); a
 * model that is down falls back to a thin template so the owner is still told.
 *
 * @returns {{sent?:boolean, held?:boolean, skipped?:boolean, line?:string, reason?:string}}
 */
export async function notifyOwnerViaRoby(ctx, { routine, agent, text, notify, gate = null, severity = null }) {
  const tg = ctx?.plugins?.get?.("telegram");
  if (!tg?.send) return { skipped: true, reason: "telegram plugin not loaded" };
  const globalConfig = ctx?.globalConfig || {};

  // Gate first — no compose, no send, no tokens when the budget holds it.
  if (gate) {
    const decision = canNudge(
      {
        kind: `delivery:${agent.slug}`,
        project_id: gate.project_id ?? null,
        severity: gate.severity || "normal",
        unsolicited: gate.unsolicited !== false,
        scheduled: gate.scheduled === true,
        channel: CHANNELS.TELEGRAM,
      },
      globalConfig,
    );
    if (!decision.allowed) return { held: true, reason: decision.reason };
    const line = await composeRobyNotice({ agent, text, notify, globalConfig, severity });
    await tg.send({ text: line, meta: { via: "delivery_notify", routine: routine.name, routine_id: routine.id || "", agent: agent.slug } });
    recordNudge(decision, { preview: line });
    return { sent: true, line, reason: decision.reason };
  }

  const line = await composeRobyNotice({ agent, text, notify, globalConfig, severity });
  await tg.send({ text: line, meta: { via: "delivery_notify", routine: routine.name, routine_id: routine.id || "", agent: agent.slug } });
  return { sent: true, line };
}

/** The one Telegram line, written as Roby. Model-authored; a thin template only
 *  when the model is unavailable, so the owner is never left un-told. */
async function composeRobyNotice({ agent, text, notify, globalConfig, severity = null }) {
  const robyName = resolveAgentName(globalConfig) || "Roby";
  const who = agent.name || agent.slug;
  const model = globalConfig?.super_agent?.model;
  // A `critical` relay is an alert, not a "you have a reply waiting" nudge — the
  // line has to read as urgent so the owner acts on it now.
  const urgent = severity === "critical";
  if (model) {
    try {
      const r = await callEngine({
        modelId: model,
        system: urgent
          ? `You are ${robyName}, Manu's personal assistant. The agent "${who}" just flagged something CRITICAL ` +
            `that needs Manu now. Write ONE short line (max ~160 characters) to send Manu on Telegram, in HIS ` +
            `language, making clear it is urgent and from ${who}, and hinting what the problem is. No preamble, ` +
            `no quotes — just the line.`
          : `You are ${robyName}, Manu's personal assistant. The agent "${who}" just left Manu a message ` +
            `in its own chat and it is waiting for a reply. Write ONE short line (max ~160 characters) to ` +
            `send Manu on Telegram, in HIS language, telling him he has something to answer from ${who} and ` +
            `hinting what it is about. Warm and brief. No preamble, no quotes — just the line.`,
        messages: [{ role: "user", content: `What ${who} left:\n\n${notify || text || ""}` }],
        config: globalConfig,
      });
      const line = String(r.text || "").replace(/\s+/g, " ").trim();
      if (line) return line;
    } catch { /* fall through to the template floor */ }
  }
  if (urgent) return `⚠️ ${who} marcó algo crítico${notify ? `: ${notify}` : ""} — revisalo ahora en su chat.`;
  return `${who} te dejó un mensaje${notify ? `: ${notify}` : ""} — respondé en su chat.`;
}

export const DELIVERY_ADAPTERS = Object.freeze({
  [CHANNELS.TELEGRAM]: {
    id: CHANNELS.TELEGRAM,
    // A channel that reaches a PHONE. What makes it valuable — it arrives
    // whether or not you went looking — is also what makes it the wrong place
    // for a routine's reasoning, so `abstentionChannels` routes around it.
    push: true,
    // The tool that would produce the same message from inside the loop. The
    // runner suppresses it for the run, the way it already suppresses the tool
    // an equivalent post_command would duplicate.
    overlapTools: [TOOLS.SEND_TELEGRAM],
    async deliver(ctx, { routine, text, gate, attachments }) {
      const tg = ctx?.plugins?.get?.("telegram");
      if (!tg?.send) throw new Error("telegram plugin not loaded");

      // Send the queued images AFTER the text lands, each as its own photo. The
      // text is the message that must always arrive, so a photo that fails to
      // upload never costs the words. Skipped when the plugin can't send photos.
      const sendPhotos = async () => {
        const shots = (attachments || []).filter((a) => a && a.path);
        if (!shots.length || typeof tg.sendPhoto !== "function") return 0;
        let sent = 0;
        for (const a of shots) {
          try {
            await tg.sendPhoto({ photo: a.path, caption: a.caption || "", author: "apx" });
            sent++;
          } catch { /* one bad image must not sink the rest */ }
        }
        return sent;
      };

      // The interruption budget. Suppressing send_telegram for a delivering
      // routine moved this push off the tool that used to gate it, so the gate
      // has to live here or a watch would push every 20 minutes regardless of
      // budget or quiet-hours. An anchor passes as `scheduled`; a blocker
      // passes as `critical`; a solicited reply passes as `unsolicited: false`;
      // an ordinary status/fyi is held when the budget says so. `gate: null`
      // (a caller that hasn't opted in) delivers unconditionally, as before.
      if (gate) {
        const decision = canNudge(
          {
            kind: `routine:${routine.name}`,
            project_id: gate.project_id ?? null,
            severity: gate.severity || "normal",
            unsolicited: gate.unsolicited !== false,
            scheduled: gate.scheduled === true,
            channel: CHANNELS.TELEGRAM,
          },
          ctx?.globalConfig || {},
        );
        if (!decision.allowed) return { held: true, reason: decision.reason };
        await tg.send({
          text,
          meta: { routine: routine.name, routine_id: routine.id || "", via: "routine_delivery" },
        });
        const sent = await sendPhotos();
        recordNudge(decision, { preview: text });
        return { note: `sent to telegram (${decision.reason})${sent ? ` +${sent} photo${sent > 1 ? "s" : ""}` : ""}` };
      }

      await tg.send({
        text,
        meta: { routine: routine.name, routine_id: routine.id || "", via: "routine_delivery" },
      });
      const sent = await sendPhotos();
      return { note: `sent to telegram${sent ? ` +${sent} photo${sent > 1 ? "s" : ""}` : ""}` };
    },
  },
  [CHANNELS.WEB]: ledgerAdapter(CHANNELS.WEB),
});

/** The channel ids `deliver_to` accepts, for help text and validation. */
export function deliveryChannelIds() {
  return Object.keys(DELIVERY_ADAPTERS);
}

/**
 * Where an ABSTENTION goes. Never a push channel — the whole point is that the
 * routine decided not to interrupt, and pushing "I decided not to interrupt you"
 * is the interruption it just declined to make.
 *
 * It does not go nowhere either. Manu's rule when he found these on his phone:
 * do not send it to Telegram, "que lo diga en canal web sino" — leave it
 * somewhere he can go and look at it. So a routine whose channels are all push
 * writes the note to the web thread instead of dropping it, and every row is
 * stamped `abstained` so a reader can tell a decision from a message.
 */
export function abstentionChannels(channels) {
  const quiet = (channels || []).filter((id) => DELIVERY_ADAPTERS[id] && !DELIVERY_ADAPTERS[id].push);
  return quiet.length ? quiet : [CHANNELS.WEB];
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
export async function deliverRoutineOutput(ctx, { routine, channels, text, gate = null, attachments = [], agent = null, abstained = false }) {
  const out = [];
  for (const id of channels || []) {
    const adapter = DELIVERY_ADAPTERS[id];
    if (!adapter) {
      out.push({ channel: id, status: "error", error: `unknown delivery channel: ${id}` });
      continue;
    }
    try {
      const r = await adapter.deliver(ctx, { routine, text, gate, attachments, agent, abstained });
      // "held" is not "ok" and not "error": the interruption budget did its job.
      // The caller must not treat it as a failed delivery — the message was
      // deliberately withheld, and the message the model wrote survives in the
      // run log / routine memory to fold into the next brief.
      if (r?.held) out.push({ channel: id, status: "held", reason: r.reason });
      else out.push({ channel: id, status: "ok", ...(r?.note ? { note: r.note } : {}) });
    } catch (e) {
      out.push({ channel: id, status: "error", error: e?.message || String(e) });
    }
  }
  return out;
}
