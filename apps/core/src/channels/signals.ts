// An answer that is a signal to APX, not words for the chat ("SKIP", "REACT ❤️", "STICKER a bear with a heart"): its
// words leave the chat (the model log keeps them), a reaction goes on the message it answers (on the platform too when
// that message came from there), a sticker goes out instead of words, and the chat's preview says what happened
// instead of the signal.
import type { ChannelInfo } from "@apx/protocol";
import { partOfMedia } from "../domain/media.ts";
import type { NewNotification } from "../domain/notifications.ts";
import { OWNER_ID } from "../domain/persons.ts";
import { answersChecked, type RunRecord } from "../domain/runs.ts";
import type { Store } from "../domain/store.ts";
import { previewOf } from "../domain/threads.ts";
import { isSkip } from "../engine/routines.ts";
import { errorMessage } from "../errors.ts";
import type { Log } from "../log.ts";
import { reactAnswer } from "./closers.ts";
import type { Delivery } from "./delivery.ts";
import { type Stickers, stickerAnswer } from "./stickers.ts";
import { channelTexts } from "./texts.ts";
import type { ChannelAdapter, ChannelConfig } from "./types.ts";

type Target = { adapter: ChannelAdapter; config: ChannelConfig; status: ChannelInfo["status"] };
type To = { channel: string; conversation: string };

/** Turns that answer someone in a chat (not a routine, a delegation or a job's result). */
const CONVERSATION = new Set(["user", "channel", "hours_began"]);

export function createSignals(deps: {
  store: Store;
  log: Log;
  live: (id: string) => Target | undefined;
  attention: (n: NewNotification) => void;
  delivery: Pick<Delivery, "enqueue">;
  stickers: Pick<Stickers, "find">;
}) {
  const { store, log } = deps;

  /** Puts the agent's emoji on a platform message; false when the channel has no reactions or is not running. */
  async function reactOn(id: string, conversation: string, ref: string, emoji: string): Promise<boolean> {
    const l = deps.live(id);
    if (l?.status !== "running" || !l.adapter.caps.reactions || !l.adapter.react) return false;
    // Kept with what was sent, so the owner sees the reaction among the channel's messages.
    const kept = (error?: string) =>
      store.channels.outbox.settled({ channel: id, conversation, body: { text: "", reaction: emoji }, error });
    try {
      await l.adapter.react(conversation, ref, emoji);
    } catch (err) {
      kept(errorMessage(err, 200));
      throw err;
    }
    kept();
    return true;
  }

  /**
   * A finished turn's answer, when it is a signal: done here, and true. `to` is where the turn answers on a channel;
   * none when it answers in the app only.
   */
  async function handle(run: RunRecord, out: string, to: To | undefined): Promise<boolean> {
    const origin = run.input?.origin;
    if (run.state !== "completed" || !(CONVERSATION.has(origin?.kind ?? "") || answersChecked(origin))) return false;
    if (isSkip(out)) {
      // In the app alone the words never show (the panel hides them); a channel's chat drops them.
      if (to) hideWords(run.message_id);
      showLast(run);
      return true;
    }
    const wanted = stickerAnswer(out);
    if (wanted) {
      if (to) sendSticker(run, to, wanted);
      else hideWords(run.message_id);
      return true;
    }
    const emoji = reactAnswer(out);
    if (!emoji) return false;
    // The owner wrote in the app to their own chat: the message it answers is only here, none on the platform.
    const ownChat = to && store.persons.byAddress(to.channel, to.conversation)?.id === OWNER_ID;
    if (to && !(ownChat && run.input?.origin.kind === "user")) await reactInstead(run, to, emoji);
    else reactHere(run, emoji);
    return true;
  }

  /** The agent's emoji on the owner's (or a contact's) message the turn answered, in the app. */
  function reactHere(run: RunRecord, emoji: string): void {
    const origin = run.input?.origin;
    const asked = origin?.kind === "user" || origin?.kind === "channel" ? origin.message_id : undefined;
    const target = asked ? store.messages.get(asked) : answered(run);
    hideWords(run.message_id);
    if (!target) return;
    store.messages.setReaction(target.id, "agent", emoji);
    reacted(run, emoji);
  }

  /** The agent answered with a reaction to the other side's last message on the channel: put on it, and shown here. */
  async function reactInstead(run: RunRecord, to: To, emoji: string) {
    const last = theirLast(run.thread_id, to);
    let refused: string | undefined;
    const ok =
      last &&
      (await reactOn(to.channel, to.conversation, last.ref, emoji).catch((err: unknown) => {
        refused = errorMessage(err, 200);
        log.warn({ run: run.id, err: refused }, "channel reaction not sent");
        return false;
      }));
    hideWords(run.message_id);
    if (ok) {
      if (last.message_id) store.messages.setReaction(last.message_id, "agent", emoji);
      reacted(run, emoji);
      return;
    }
    // Words instead would be a stray emoji in their chat: nothing goes, and the owner hears why.
    const where = store.threads.get(run.thread_id)?.title ?? to.channel;
    const texts = channelTexts(store);
    const text = refused ? texts.reactRefused(emoji, where, refused) : texts.reactFailed(emoji, where);
    deps.attention({ kind: "channel", level: "warn", title: where, body: text, thread_id: run.thread_id });
  }

  /** The agent answered with a sticker it was sent on this platform: it goes out, and shows here in its words' place. */
  function sendSticker(run: RunRecord, to: To, words: string): void {
    const l = deps.live(to.channel);
    const s = l?.adapter.caps.stickers ? deps.stickers.find(l.config.type, words) : undefined;
    const media = s && store.media.get(s.media_id);
    const msg = run.message_id ? store.messages.get(run.message_id) : undefined;
    if (!s || !media) {
      hideWords(run.message_id);
      // The nearest sticker could say something else: nothing goes, and the owner hears why.
      const where = store.threads.get(run.thread_id)?.title ?? to.channel;
      const body = channelTexts(store).stickerMissing(words, where);
      deps.attention({ kind: "channel", level: "warn", title: where, body, thread_id: run.thread_id });
      return;
    }
    const shown =
      media.kind === "image"
        ? { type: "image" as const, media_id: media.id, mime: media.mime, alt: s.meaning ?? "sticker" }
        : partOfMedia(media);
    if (msg) store.messages.update({ ...msg, parts: [...msg.parts.filter((p) => p.type !== "text"), shown] });
    deps.delivery.enqueue({
      channel: to.channel,
      conversation: to.conversation,
      thread_id: run.thread_id,
      ...(msg ? { message_id: msg.id } : {}),
      kind: "reply",
      body: { text: "", media: [{ id: media.id, kind: "sticker", mime: media.mime, about: s.meaning }] },
    });
    store.stickers.sentOnce(s.id);
    store.threads.patch(run.thread_id, { preview: channelTexts(store).sentSticker(s.meaning ?? "") }, false);
  }

  /**
   * The other side's last message in a chat: as kept when it arrived, else the last one stored for that
   * conversation (messages from before that was kept; shown on the contact's last message here).
   */
  function theirLast(threadId: string, to: To) {
    const kept = store.threads.context(threadId).their_last;
    if (kept?.channel === to.channel && kept.conversation === to.conversation) return kept;
    const m = store.channels.inbox.latest(to.channel, to.conversation);
    // A WhatsApp message's own id is its external_id; other channels' older rows did not keep one.
    const ref = m?.ref ?? (deps.live(to.channel)?.config.type === "whatsapp" ? m?.external_id : undefined);
    if (!ref) return undefined;
    const theirs = store.messages.list(threadId).findLast((x) => x.author.kind === "person");
    return { ref, message_id: theirs?.id };
  }

  /** The last message someone wrote before the turn's answer. */
  function answered(run: RunRecord) {
    const all = store.messages.list(run.thread_id);
    const at = all.findIndex((m) => m.id === run.message_id);
    return all
      .slice(0, at < 0 ? all.length : at)
      .findLast((m) => m.author.kind === "user" || m.author.kind === "person");
  }

  function hideWords(messageId: string | undefined): void {
    const msg = messageId ? store.messages.get(messageId) : undefined;
    if (msg) store.messages.update({ ...msg, parts: msg.parts.filter((p) => p.type !== "text") });
  }

  /** The chat's preview says the agent reacted, not the signal it wrote. */
  function reacted(run: RunRecord, emoji: string): void {
    store.threads.patch(run.thread_id, { preview: channelTexts(store).reacted(emoji) }, false);
  }

  /** Nothing was said: the chat's preview goes back to its last words. */
  function showLast(run: RunRecord): void {
    const last = store.messages
      .list(run.thread_id)
      .findLast((m) => m.id !== run.message_id && m.parts.some((p) => p.type === "text" && p.text.trim()));
    const words = last?.parts.flatMap((p) => (p.type === "text" ? [p.text] : [])).join("\n") ?? "";
    store.threads.patch(run.thread_id, { preview: previewOf(words.trim()) }, false);
  }

  return { reactOn, handle };
}
