import type { Person, Thread } from "@apx/protocol";
import type { Bus } from "../bus.ts";
import type { Inbound, InboxRow } from "../domain/channels.ts";
import type { Store } from "../domain/store.ts";
import { errorMessage } from "../errors.ts";
import type { Log } from "../log.ts";
import { saveUpload } from "../services/uploads.ts";
import { quietMessage } from "./quiet-message.ts";
import type { ChannelConfig } from "./types.ts";

/** Capturing a mailbox sender does not approve or silence their later personal messages. */
export function capturedSender(
  store: Store,
  cfg: ChannelConfig,
  message: Inbound,
  person: Person,
): "stranger" | Person {
  const thread = store.threads.byConversation(cfg.id, message.conversation);
  if (!thread || !person.unreviewed || !store.threads.context(thread.id).mail_capture_only) return person;
  if (cfg.strangers === "pair" || cfg.strangers === "ignore") return "stranger";
  store.threads.mergeContext(thread.id, { mail_capture_only: undefined });
  return cfg.strangers === "answer" ? (store.persons.update(person.id, { muted: false }) ?? person) : person;
}

/** Display, model context and the inbox's terminal state commit together, before alerts or display events. */
export function createPassiveMail(deps: {
  store: Store;
  bus: Bus;
  home: string;
  log: Log;
  configs(): ChannelConfig[];
  thread(cfg: ChannelConfig, message: Inbound, person: Person): Thread;
  keepHtml(thread: string, message: Inbound, id: string): void;
  report(cfg: ChannelConfig, person: Person, sender: string, text: string, thread: string): void;
}) {
  const { store } = deps;
  const keep = quietMessage(store);
  return (row: Pick<InboxRow, "id" | "channel" | "payload">): "done" | "ignored" => {
    const m = row.payload;
    // Automatic mail kept before marks existed carries no mark of its own.
    const mark = m.mail_handling === "marked" ? m.mail_mark : m.mail_handling === "automatic" ? "automatic" : undefined;
    const kept = store.tx(() => {
      const cfg = deps.configs().find((c) => c.id === row.channel);
      let person = store.persons.byAddress(row.channel, m.sender.id);
      // Marked mail is kept from anyone, blocked or not; never as the owner's (a mark on their address is a forgery).
      const refused = mark
        ? person?.role === "owner" && mark !== "automatic"
        : person?.role === "blocked" || (!person && cfg?.strangers === "ignore");
      if (cfg?.type !== "email" || refused) {
        store.channels.inbox.done(row.id, "ignored");
        return undefined;
      }
      const fresh = !person;
      if (!person) {
        person = store.persons.create({ name: m.sender.name.slice(0, 80), role: "contact", unreviewed: true });
        store.persons.link(person.id, { channel: cfg.id, external_id: m.sender.id, label: person.name });
      }
      const thread = deps.thread(cfg, m, person);
      if (fresh) store.threads.mergeContext(thread.id, { mail_capture_only: true });
      if (mark && !store.threads.context(thread.id).mail_people)
        store.threads.mergeContext(thread.id, { mail_mark: mark });
      let text = m.text;
      const files: string[] = [];
      for (const file of m.files ?? []) {
        try {
          files.push(
            saveUpload(deps.home, store, {
              name: file.name,
              mime: file.mime,
              bytes: Buffer.from(file.data, "base64"),
              thread: thread.id,
            }).id,
          );
        } catch (err) {
          text += `\n[attachment could not be accepted: ${errorMessage(err, 200)}]`;
        }
      }
      const id = keep(
        thread.id,
        cfg.id,
        person,
        text,
        files,
        { answered: "no: automatic or recovered mail" },
        {
          at: m.mail_received_at,
          historical: m.mail_handling === "history",
          deferEvent: true,
          mark,
        },
      );
      store.channels.inbox.done(row.id, "done");
      return { cfg, person, thread, id, text };
    });
    if (!kept) return "ignored";
    try {
      const message = store.messages.get(kept.id);
      if (message) deps.bus.emit({ type: "message.created", message });
      deps.keepHtml(kept.thread.id, m, kept.id);
      if (!mark && m.mail_handling !== "history" && (kept.person.unreviewed || !kept.person.muted))
        deps.report(kept.cfg, kept.person, m.sender.id, kept.text, kept.thread.id);
    } catch (err) {
      deps.log.warn({ inbox: row.id, err: errorMessage(err, 200) }, "stored mail not announced");
    }
    return "done";
  };
}
