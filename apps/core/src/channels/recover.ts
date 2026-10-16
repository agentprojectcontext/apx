// Files lost on the way in: a message kept as a placeholder ("[video — APX cannot read…]", "[attachment could not be
// downloaded…]") gets its file from the platform again (WhatsApp: the owner's phone sends the message again), in place.
// It starts no turn: the agent already answered those words.
import { type Message, type Part, UPLOAD_LIMITS } from "@apx/protocol";
import { partOfMedia } from "../domain/media.ts";
import type { Store } from "../domain/store.ts";
import { errorMessage } from "../errors.ts";
import type { Log } from "../log.ts";
import { saveUpload } from "../services/uploads.ts";
import type { ChannelAdapter } from "./types.ts";

/** What a lost file left in its message instead of itself (the caption, if any, stays around it). */
const LOST =
  /\n?\[(?:(?:photo|video|file|sticker) — APX cannot read this kind of message yet|attachment could not be downloaded: [^\]\n]*)\]/;
/** A placeholder message is stored a moment after its inbox row; this much earlier is not it. */
const SKEW_MS = 60_000;
/** The platform's answers and the downloads, all of them (the client waits 170 s). */
const DEADLINE_MS = 150_000;

export type Recovery = {
  asked: number;
  recovered: Array<{ message_id: string; name: string }>;
  missing: Array<{ message_id: string; reason: string }>;
  reason?: string;
};

const textOf = (m: Message) =>
  m.parts
    .flatMap((p) => (p.type === "text" ? [p.text] : []))
    .join("\n")
    .trim();
const hasFile = (m: Message) => m.parts.some((p) => p.type === "image" || p.type === "file");
const ms = (iso: string) => new Date(iso).getTime();

export function createRecovery(deps: {
  store: Store;
  home: string;
  log: Log;
  /** A channel's adapter, its name and whether it runs. */
  target(channel: string): { adapter: ChannelAdapter; label: string; running: boolean } | undefined;
}) {
  const { store } = deps;

  /** The lost messages of a chat, each with the platform message it was (oldest first). */
  function lostIn(threadId: string, channel: string, conversation: string) {
    const rows = store.channels.inbox
      .history(channel, conversation)
      .filter((r) => LOST.test(r.payload.text) && !r.payload.files?.length);
    const messages = store.messages
      .list(threadId, 2000)
      .filter((m) => (m.author.kind === "person" || m.author.kind === "user") && !hasFile(m) && LOST.test(textOf(m)));
    const used = new Set<string>();
    return rows.flatMap((row) => {
      const said = row.payload.text.trim();
      const m = messages.find(
        (x) => !used.has(x.id) && textOf(x) === said && ms(x.created_at) >= ms(row.created_at) - SKEW_MS,
      );
      if (!m) return [];
      used.add(m.id);
      return [{ row, message: m }];
    });
  }

  async function recover(threadId: string): Promise<Recovery> {
    const thread = store.threads.get(threadId);
    if (!thread?.channel) throw new Error("this chat is not on a channel");
    const { id: channel, conversation } = thread.channel;
    const t = deps.target(channel);
    if (!t) throw new Error(`channel ${channel} is not set up`);
    if (!t.adapter.recover) throw new Error(`${t.label} cannot send old messages again`);
    if (!t.running) throw new Error(`${t.label} is not running`);
    const lost = lostIn(thread.id, channel, conversation);
    const none = { asked: lost.length, recovered: [], missing: [] };
    if (!lost.length) return { ...none, reason: "No message in this chat is waiting for its file" };
    // The owner's own words in their chat on the line are theirs: sent from their phone.
    const wanted = lost.map((l) => ({ id: l.row.external_id, fromMe: l.message.author.kind === "user" }));
    let deadline: ReturnType<typeof setTimeout> | undefined;
    const got = await Promise.race([
      t.adapter.recover(conversation, wanted),
      new Promise<never>((_, reject) => {
        deadline = setTimeout(() => reject(new Error(`${t.label} took too long to send the files`)), DEADLINE_MS);
      }),
    ]).finally(() => clearTimeout(deadline));

    const out: Recovery = { ...none, recovered: [], missing: [] };
    const silent = `${t.label} did not answer: the phone has to be online, with ${t.label} working on it`;
    for (const { row, message } of lost) {
      const found = got.found.find((f) => f.id === row.external_id);
      if (!found?.file) {
        const reason =
          found?.failure ??
          (got.found.length ? `${t.label} did not send this message again (deleted on the phone?)` : silent);
        out.missing.push({ message_id: message.id, reason });
        continue;
      }
      try {
        const media = saveUpload(
          deps.home,
          store,
          {
            name: found.file.name,
            mime: found.file.mime,
            bytes: Buffer.from(found.file.data, "base64"),
            thread: thread.id,
          },
          found.file.mime.startsWith("image/") ? undefined : UPLOAD_LIMITS.channelBytes,
        );
        const parts: Part[] = [
          ...message.parts.flatMap((p): Part[] => {
            if (p.type !== "text") return [p];
            const text = p.text.replace(LOST, "").trim();
            return text ? [{ ...p, text }] : [];
          }),
          partOfMedia(media),
        ];
        store.messages.update({ ...message, parts });
        out.recovered.push({ message_id: message.id, name: media.name });
      } catch (err) {
        out.missing.push({ message_id: message.id, reason: errorMessage(err, 200) });
      }
    }
    if (!got.found.length) out.reason = silent;
    deps.log.info(
      { channel, asked: lost.length, came: got.found.length, recovered: out.recovered.length },
      "channel files recovered",
    );
    return out;
  }

  return { recover };
}
