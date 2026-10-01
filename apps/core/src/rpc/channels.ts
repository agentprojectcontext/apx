// Channels, the people on them and pairing: owner-only methods (the router refuses anyone else).
import { ErrorCode } from "@apx/protocol";
import type { Channels } from "../channels/manager.ts";
import { publicOutbox } from "../domain/channels.ts";
import { OWNER_ID } from "../domain/persons.ts";
import type { Store } from "../domain/store.ts";
import { CallError } from "../errors.ts";
import type { Handler } from "./router.ts";
import { notFound } from "./threads.ts";

const bad = (message: string) => new CallError({ code: ErrorCode.BadRequest, message });

export function channelHandlers(store: Store, channels: Channels) {
  return {
    "channels.list": (() => ({ channels: channels.info() })) as Handler<"channels.list">,
    "channels.set": (async ({ id, channel, token }) => {
      if (channel && !store.agents.get(channel.agent_id)) throw notFound(`agent ${channel.agent_id}`);
      if (channel?.type === "telegram" && !token && !channels.info().find((c) => c.id === id)?.token_set)
        throw bad("a Telegram channel needs its bot token (from @BotFather)");
      const config = channel ? { ...channel, label: channel.label || defaultLabel(channel.type) } : null;
      return { channels: await channels.set(id, config, token) };
    }) as Handler<"channels.set">,
    "channels.outbox": (({ limit }) => ({
      items: store.channels.outbox.recent(limit).map(publicOutbox),
    })) as Handler<"channels.outbox">,

    "contacts.list": (() => {
      store.persons.owner();
      return { persons: store.persons.list() };
    }) as Handler<"contacts.list">,
    "contacts.set": (({ id, name, role, note }) => {
      if (!id) {
        if (role === "owner") throw bad("there is one owner");
        return store.persons.create({ name, role: role ?? "contact", note });
      }
      const p = store.persons.update(id, { name, ...(role ? { role } : {}), note });
      if (!p) throw notFound(`person ${id}`);
      return p;
    }) as Handler<"contacts.set">,
    "contacts.remove": (({ id, address }) => {
      if (address) return { removed: store.persons.unlink(address) };
      if (!id) throw bad("give a person or an address");
      if (id === OWNER_ID) throw bad("the owner cannot be removed");
      return { removed: store.persons.remove(id) };
    }) as Handler<"contacts.remove">,

    "pairing.list": (() => ({
      requests: store.channels.pairing.open().map(({ conversation: _c, ...r }) => r),
    })) as Handler<"pairing.list">,
    "pairing.respond": (({ code, decision, person, name }) => {
      const req = store.channels.pairing.get(code);
      if (!req) throw notFound(`pairing code ${code} (wrong or expired)`);
      if (decision === "deny") {
        store.channels.pairing.close(code, "denied");
        return {};
      }
      const who =
        decision === "owner"
          ? store.persons.owner()
          : person
            ? store.persons.get(person)
            : store.persons.create({ name: name ?? req.name, role: "contact" });
      if (!who) throw notFound(`person ${person}`);
      if (decision === "contact" && who.role === "owner") throw bad("use decision owner to link your own address");
      store.tx(() => {
        store.persons.link(who.id, { channel: req.channel, external_id: req.external_id, label: req.name });
        store.channels.pairing.close(code, "approved");
      });
      return { person: store.persons.get(who.id) };
    }) as Handler<"pairing.respond">,
  };
}

const defaultLabel = (type: string) => (type === "telegram" ? "Telegram" : type);
