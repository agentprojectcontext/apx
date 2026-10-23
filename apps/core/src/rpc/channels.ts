// Channels, the people on them and pairing: owner-only methods (the router refuses anyone else).

import fs from "node:fs";
import { type ChannelType, ErrorCode } from "@apx/protocol";
import { CHANNEL_CATALOG } from "../channels/catalog.ts";
import { pairingRef } from "../channels/inbound.ts";
import type { Channels } from "../channels/manager.ts";
import { autoApproves } from "../channels/stickers.ts";
import { normalJid } from "../channels/whatsapp.ts";
import { publicOutbox } from "../domain/channels.ts";
import { noticePrefs, saveNoticePrefs } from "../domain/notices.ts";
import { OWNER_ID } from "../domain/persons.ts";
import type { Sticker } from "../domain/stickers.ts";
import type { Store } from "../domain/store.ts";
import { badRequest, CallError, errorMessage, notFound } from "../errors.ts";
import type { Handlers } from "./router.ts";

/** How long a send waits for the platform's answer before saying it is still queued (the tools have 15 s). */
const SETTLE_MS = 8_000;

export function channelHandlers(store: Store, channels: Channels) {
  /** A message an agent sent, with how it went: an agent must not say it went when the platform refused it. */
  const withDelivery = async ({ outbox, ...sent }: ReturnType<Channels["postInRoom"]>) => ({
    ...sent,
    delivery: await channels.settled(outbox, SETTLE_MS),
  });
  /** A kept sticker as the app shows it (none when its file is gone). */
  const shown = ({ created_at: _c, hash: _h, ...s }: Sticker) => {
    const media = store.media.get(s.media_id);
    return media ? [{ ...s, mime: media.mime }] : [];
  };
  return {
    "channels.list": () => ({ channels: channels.info() }),
    // Open to agents: what channel_list shows. Disabled channels are not there for them.
    "channels.overview": () => ({
      channels: channels
        .info()
        .filter((c) => c.enabled)
        .map((c) => ({
          id: c.id,
          type: c.type,
          label: c.label,
          status: c.status,
          rooms: (c.rooms?.rooms ?? []).map((r) => ({ name: r.name || r.id, mode: r.mode })),
        })),
    }),
    "channels.set": async ({ id, channel, token }) => {
      if (channel && !store.agents.get(channel.agent_id)) throw notFound(`agent ${channel.agent_id}`);
      if (channel?.type === "telegram" && !token && !channels.info().find((c) => c.id === id)?.token_set)
        throw badRequest("a Telegram channel needs its bot token (from @BotFather)");
      const config = channel ? { ...channel, label: channel.label || defaultLabel(channel.type) } : null;
      return { channels: await channels.set(id, config, token) };
    },
    "channels.send": ({ thread, text }) => {
      if (!store.threads.get(thread)) throw notFound(`thread ${thread}`);
      try {
        channels.sendAsOwner(thread, text);
      } catch (err) {
        throw badRequest(errorMessage(err));
      }
      return { ok: true as const };
    },
    // Open to agents (the owner's, never a contact's turn): their way to write to a contact for the owner.
    "channels.message": async ({ person, text, channel, files }, ctx) => {
      let sent: ReturnType<typeof channels.messageContact>;
      try {
        sent = channels.messageContact(person, text, { channel, by: ctx.agent?.id, files });
      } catch (err) {
        throw badRequest(errorMessage(err));
      }
      return withDelivery(sent);
    },
    // Open to agents like channels.message: their way to post in a public room for the owner.
    "channels.post": async ({ room, text, channel, files }, ctx) => {
      let sent: ReturnType<typeof channels.postInRoom>;
      try {
        sent = channels.postInRoom(room, text, { channel, by: ctx.agent?.id, files });
      } catch (err) {
        throw badRequest(errorMessage(err));
      }
      return withDelivery(sent);
    },
    "channels.open": ({ person, channel }) => {
      if (!store.persons.get(person)) throw notFound(`person ${person}`);
      try {
        return channels.openChat(person, channel);
      } catch (err) {
        throw badRequest(errorMessage(err));
      }
    },
    "channels.presence": ({ channel }) => ({ people: channels.presence(channel) }),
    "channels.rooms": async ({ channel }) => {
      if (!channels.info().some((c) => c.id === channel)) throw notFound(`channel ${channel}`);
      try {
        return { rooms: await channels.serverRooms(channel) };
      } catch (err) {
        throw badRequest(errorMessage(err));
      }
    },
    "channels.recover": async ({ thread }) => {
      if (!store.threads.get(thread)) throw notFound(`thread ${thread}`);
      try {
        return await channels.recover(thread);
      } catch (err) {
        throw badRequest(errorMessage(err));
      }
    },
    "stickers.list": ({ platform }) => ({
      stickers: store.stickers.list(platform).flatMap(shown),
      auto: autoApproves(store),
    }),
    "stickers.auto": ({ on }) => {
      store.settings.set("stickers_auto", on ? "on" : "off");
      return { on };
    },
    "stickers.set": ({ id, meaning, blocked }) => {
      const s = store.stickers.set(id, { meaning, blocked });
      const out = s && shown(s)[0];
      if (!out) throw notFound(`sticker ${id}`);
      return out;
    },
    "stickers.remove": ({ id }) => {
      const s = store.stickers.get(id);
      if (!s || !store.stickers.remove(id)) return { removed: false };
      const media = store.media.get(s.media_id);
      if (media) {
        store.media.remove(media.id);
        fs.rmSync(media.path, { force: true });
      }
      return { removed: true };
    },
    "channels.outbox": ({ limit }) => ({
      items: store.channels.outbox.recent(limit).map(publicOutbox),
    }),

    "notices.get": () => noticePrefs(store),
    "notices.log": ({ limit }) => {
      const dayStart = new Date();
      dayStart.setHours(0, 0, 0, 0);
      return {
        items: store.nudges.list(limit),
        today: { sent: store.nudges.countedSince(dayStart.toISOString()), cap: noticePrefs(store).budget_per_day },
      };
    },
    "notices.feedback": ({ id, feedback }) => {
      const n = store.nudges.feedback(id, feedback, new Date().toISOString());
      if (!n) throw notFound(`notice ${id}`);
      return n;
    },
    "notices.set": (prefs) => saveNoticePrefs(store, prefs),
    "contacts.list": () => {
      store.persons.owner();
      return { persons: store.persons.list() };
    },
    "contacts.set": ({ id, name, role, ...details }) => {
      if (!id) {
        if (role === "owner") throw badRequest("there is one owner");
        const created = store.persons.create({ name, role: role ?? "contact", note: details.note });
        return store.persons.update(created.id, details) ?? created;
      }
      const p = store.persons.update(id, { name, ...(role ? { role } : {}), ...details });
      if (!p) throw notFound(`person ${id}`);
      return p;
    },
    "contacts.suggestions.list": ({ state, person, limit }) => ({
      suggestions: store.suggestions.list({ state: state === "all" ? undefined : state, person, limit }),
    }),
    "contacts.suggestions.send": async ({ id, text, author }) => {
      const { suggestion, outbox } = channels.suggestions.send(id, { text, author });
      return { suggestion, delivery: await channels.settled(outbox, SETTLE_MS) };
    },
    "contacts.suggestions.discard": ({ id }) => ({ suggestion: channels.suggestions.discard(id) }),
    "contacts.remove": ({ id, address }) => {
      if (address) return { removed: store.persons.unlink(address) };
      if (!id) throw badRequest("give a person or an address");
      if (id === OWNER_ID) throw badRequest("the owner cannot be removed");
      return { removed: store.persons.remove(id) };
    },
    "contacts.claim": ({ address }) => ({ moved: store.persons.giveToOwner(address) }),
    "contacts.avatar": async ({ person }) => {
      if (!store.persons.get(person)) throw notFound(`person ${person}`);
      const media = await channels.avatar(person);
      return media ? { media_id: media } : {};
    },
    "contacts.address": ({ channel, address, person }) => {
      const cfg = channels.info().find((c) => c.id === channel);
      if (!cfg) throw notFound(`channel ${channel}`);
      const external = typedAddress(cfg.type, address);
      if (!external) throw badRequest(`"${address}" is not a ${cfg.label} address`);
      const who = person ? store.persons.get(person) : store.persons.owner();
      if (!who) throw notFound(`person ${person}`);
      store.tx(() => store.persons.link(who.id, { channel, external_id: external, label: cfg.label }));
      return store.persons.get(who.id) as NonNullable<ReturnType<typeof store.persons.get>>;
    },

    "pairing.list": () => ({
      requests: store.channels.pairing.open().map(({ conversation: _c, ...r }) => r),
    }),
    "pairing.respond": ({ code, decision, person, name }) => {
      const req = store.channels.pairing.get(code);
      if (!req) {
        // What became of it travels as detail, so a client can say what to do next in the owner's language.
        const was = store.channels.pairing.status(code);
        if (was && was !== "pending")
          throw new CallError({
            code: ErrorCode.Conflict,
            message: `pairing code ${code} is ${was}`,
            detail: { pairing: was },
          });
        throw notFound(`pairing code ${code}`);
      }
      store.notifications.resolve("channel", pairingRef(code));
      if (decision === "deny") {
        store.channels.pairing.close(code, "denied");
        return {};
      }
      if (person && !store.persons.get(person)) throw notFound(`person ${person}`);
      if (decision === "contact" && person === OWNER_ID)
        throw badRequest("use decision owner to link your own address");
      const id = store.tx(() => {
        const who =
          decision === "owner"
            ? store.persons.owner()
            : person
              ? (store.persons.get(person) as NonNullable<ReturnType<typeof store.persons.get>>)
              : store.persons.create({ name: (name ?? req.name).slice(0, 80), role: "contact" });
        store.persons.link(who.id, { channel: req.channel, external_id: req.external_id, label: req.name });
        store.channels.pairing.close(code, "approved");
        return who.id;
      });
      channels.approved(req);
      return { person: store.persons.get(id) };
    },
  } satisfies Partial<Handlers>;
}

/** What the owner typed as the address the channel uses: a WhatsApp number's account, a Telegram chat id. */
function typedAddress(type: string, typed: string): string | undefined {
  if (type === "whatsapp") {
    if (typed.includes("@")) return normalJid(typed) || undefined;
    const digits = typed.replace(/\D/g, "");
    return digits.length >= 8 && digits.length <= 15 ? `${digits}@s.whatsapp.net` : undefined;
  }
  const a = typed.trim().toLowerCase();
  const mail = /^[^\s<>@,;"]+@[^\s<>@,;"]+\.[^\s<>@,;"]+$/.test(a) ? a : undefined;
  if (type === "email") return mail;
  // A phone number as the platform writes it (+E.164); iMessage also knows people by their Apple ID's mail.
  if (type === "sms" || type === "imessage") {
    const phone = typed.replace(/[\s().-]/g, "");
    return /^\+[1-9]\d{6,14}$/.test(phone) ? phone : type === "imessage" ? mail : undefined;
  }
  return /^-?\d{3,20}$/.test(typed.trim()) ? typed.trim() : undefined;
}
const defaultLabel = (type: string) => CHANNEL_CATALOG[type as ChannelType]?.label ?? type;
