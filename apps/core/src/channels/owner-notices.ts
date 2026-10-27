// What the channels tell the owner. The app's tray (and with it their phones) always hears it; the chat app they picked
// hears it too, buttons only where they may answer there (DECISIONS.md#d-144, DECISIONS.md#d-161). Every notice for the
// owner from this folder goes through `tell`, a card or news through `notifyOwner`.
import type { ChannelInfo, Part } from "@apx/protocol";
import { type OutboxRow, ownerActsOn, type Presentation } from "../domain/channels.ts";
import { appOnly, noticePrefs, quietNow } from "../domain/notices.ts";
import type { NewNotification } from "../domain/notifications.ts";
import { OWNER_ID } from "../domain/persons.ts";
import type { Store } from "../domain/store.ts";
import type { Delivery } from "./delivery.ts";
import { inputPresentation } from "./notices.ts";
import { channelTexts } from "./texts.ts";
import type { ChannelConfig } from "./types.ts";

/** What a notice shows in the tray; its kind is always "channel", its body the words unless they differ. */
export type TrayNotice = Omit<NewNotification, "kind" | "body"> & { body?: string };

/** The owner hears it in the tray and on their chat app: one notice, two places. */
export type TellOwner = (said: Presentation, tray: TrayNotice, kind?: OutboxRow["kind"]) => void;

export function createOwnerNotices(deps: {
  store: Store;
  /** The channels started, in no particular order. */
  live: () => Iterable<{ config: ChannelConfig; status: ChannelInfo["status"] }>;
  configs: () => ChannelConfig[];
  delivery: () => Delivery;
  attention: (n: NewNotification) => void;
}) {
  const { store } = deps;

  /**
   * Something for the owner, on their preferred channel or another that knows them (the outbox waits while it is not
   * running); in quiet hours it arrives without sound. False when no channel knows the owner.
   */
  function notifyOwner(body: Presentation, kind: OutboxRow["kind"] = "notice", threadId?: string): boolean {
    const prefs = noticePrefs(store);
    // The app only: what is told here is in the tray and on their phones already.
    if (appOnly(prefs)) return false;
    const refused = new Set(body.refused_by);
    const order = [...deps.live()]
      .filter((l) => !refused.has(l.config.id))
      .sort(
        (a, b) =>
          Number(b.config.id === prefs.channel) - Number(a.config.id === prefs.channel) ||
          Number(b.status === "running") - Number(a.status === "running"),
      );
    for (const l of order) {
      const addr = store.persons.ownerAddress(l.config.id);
      if (!addr) continue;
      enqueue(l.config.id, addr.external_id, body, kind, threadId);
      return true;
    }
    return false;
  }

  /** One notice for the owner: in the app's tray always, on their chat app when they picked one. */
  const tell: TellOwner = (said, tray, kind = "notice") => {
    notifyOwner(said, kind, tray.thread_id);
    deps.attention({ ...tray, kind: "channel", body: tray.body ?? said.text });
  };

  /**
   * Something about a chat of the owner's: on the channel Home is talking on when it is Home's and that channel is started,
   * else wherever notices go.
   */
  function notifyOnChat(body: Presentation, threadId: string, started: (channel: string) => boolean): void {
    const thread = store.threads.get(threadId);
    // With the app only chosen, not even there (DECISIONS.md#d-161).
    const to =
      thread && thread.kind === "home" && !appOnly(noticePrefs(store))
        ? store.threads.context(threadId).reply_to
        : undefined;
    if (to && started(to.channel)) enqueue(to.channel, to.conversation, body, "notice", threadId);
    else notifyOwner(body, "notice", threadId);
  }

  function enqueue(
    channel: string,
    conversation: string,
    body: Presentation,
    kind: OutboxRow["kind"],
    threadId: string | undefined,
  ): void {
    deps.delivery().enqueue({
      channel,
      conversation,
      thread_id: threadId,
      kind,
      body: { ...shownOn(channel, body), ...(quietNow(store) ? { silent: true } : {}) },
    });
  }

  /**
   * Something for the owner as a channel shows it: buttons only where the owner may answer there, so where the platform cannot vouch for them and
   * for a card only the app answers they give way to where it is answered (DECISIONS.md#d-144).
   */
  function shownOn(channel: string, body: Presentation): Presentation {
    const appOnly = body.input_id ? store.inputs.get(body.input_id)?.app_only : undefined;
    const type = deps.configs().find((c) => c.id === channel)?.type;
    if (!body.buttons?.length || (ownerActsOn(type) && !appOnly)) return body;
    const { buttons: _b, ...rest } = body;
    return { ...rest, text: `${body.text}\n\n${channelTexts(store).inApp}` };
  }

  /**
   * A notice, confirmation or pairing request for the owner that their channel refused goes to the next channel that
   * knows them; with none left, the app's tray says it never arrived.
   */
  function ownerFallback(o: OutboxRow): void {
    if (o.kind === "reply" || store.persons.byAddress(o.channel, o.conversation)?.id !== OWNER_ID) return;
    const { skip: _skip, refused_by = [], ...body } = o.body;
    if (notifyOwner({ ...body, refused_by: [...refused_by, o.channel] }, o.kind, o.thread_id)) return;
    const texts = channelTexts(store);
    deps.attention({
      kind: "channel",
      level: "error",
      title: texts.noticeLostTitle,
      body: texts.noticeLost([...refused_by, o.channel].join(", "), o.error ?? "", o.text.slice(0, 200)),
      thread_id: o.thread_id,
    });
  }

  /**
   * What a question reaches the owner's channel as: the super-agent's own, whole with its buttons; a teammate's, one
   * line saying who waits and on what, answered in the app where the card is (DECISIONS.md#d-163).
   */
  function cardFor(part: Extract<Part, { type: "input" }>): Presentation {
    const asker = store.inputs.get(part.input_id)?.agent_id;
    const boss = store.agents.list().find((a) => a.kind === "secretary");
    if (asker && boss && asker !== boss.id) {
      const what = part.prompt.length > 200 ? `${part.prompt.slice(0, 199)}…` : part.prompt;
      return { text: channelTexts(store).waiting(store.agents.get(asker)?.name ?? asker, what) };
    }
    return { ...inputPresentation(part, channelTexts(store)), input_id: part.input_id };
  }

  return { notifyOwner, tell, notifyOnChat, shownOn, ownerFallback, cardFor };
}
