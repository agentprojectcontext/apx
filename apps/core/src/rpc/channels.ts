// Channels, the people on them and pairing: owner-only methods (the router refuses anyone else).

import { ErrorCode } from "@apx/protocol";
import { pairingRef } from "../channels/inbound.ts";
import type { Channels } from "../channels/manager.ts";
import { publicOutbox } from "../domain/channels.ts";
import { noticePrefs, saveNoticePrefs } from "../domain/notices.ts";
import { OWNER_ID } from "../domain/persons.ts";
import type { Store } from "../domain/store.ts";
import { badRequest, CallError, errorMessage, notFound } from "../errors.ts";
import type { Handlers } from "./router.ts";

export function channelHandlers(store: Store, channels: Channels) {
  return {
    "channels.list": () => ({ channels: channels.info() }),
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
    "channels.outbox": ({ limit }) => ({
      items: store.channels.outbox.recent(limit).map(publicOutbox),
    }),

    "notices.get": () => noticePrefs(store),
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
    "contacts.remove": ({ id, address }) => {
      if (address) return { removed: store.persons.unlink(address) };
      if (!id) throw badRequest("give a person or an address");
      if (id === OWNER_ID) throw badRequest("the owner cannot be removed");
      return { removed: store.persons.remove(id) };
    },
    "contacts.claim": ({ address }) => ({ moved: store.persons.giveToOwner(address) }),

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
      return { person: store.persons.get(id) };
    },
  } satisfies Partial<Handlers>;
}

const defaultLabel = (type: string) => (type === "telegram" ? "Telegram" : type);
