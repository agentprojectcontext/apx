// The stickers people send, kept the moment one arrives (once per platform and file) and named once by a model that
// reads images, so the agent reads "[sticker: a bear holding a heart balloon]" and can answer with one it was sent.
// See rules/DECISIONS.md#d-137
import { createHash } from "node:crypto";
import fs from "node:fs";
import { UPLOAD_LIMITS } from "@apx/protocol";
import type { AuxAbout } from "../domain/aux-calls.ts";
import type { Sticker } from "../domain/stickers.ts";
import type { Store } from "../domain/store.ts";
import { errorMessage } from "../errors.ts";
import type { Log } from "../log.ts";
import { saveUpload } from "../services/uploads.ts";
import type { InboundFile } from "./types.ts";

/** How long a message waits for its sticker to be named before the agent reads it unnamed (it is named later). */
const NAME_WAIT_MS = 20_000;

const NAME_PROMPT = (language: string) =>
  `You name chat stickers. In ${language}, in a few words (at most ten), say what the sticker shows and the feeling ` +
  `or answer it carries, like "white bear holding a heart balloon, affection". Only those words.`;

export type See = (
  system: string,
  user: string,
  image: { mime: string; data: string },
  about: AuxAbout,
) => Promise<string | undefined>;

export function createStickers(deps: { store: Store; home: string; log: Log; see?: See | undefined }) {
  const { store, log } = deps;
  const pending = new Map<string, Promise<Sticker>>();

  /** A sticker that arrived: kept (or counted again) and named; resolves once named, or unnamed after a while. */
  async function keep(
    platform: string,
    file: InboundFile,
    threadId?: string,
    naming = true,
  ): Promise<Sticker | undefined> {
    const bytes = Buffer.from(file.data, "base64");
    const hash = createHash("sha256").update(bytes).digest("hex");
    let s = store.stickers.byHash(platform, hash);
    if (s) store.stickers.seenAgain(s.id);
    else {
      try {
        // Kept apart from the chat it came in: the sticker outlives that chat.
        const media = saveUpload(
          deps.home,
          store,
          { name: file.name, mime: file.mime, bytes },
          UPLOAD_LIMITS.imageBytes,
        );
        s = store.stickers.add({ platform, hash, media_id: media.id, hint: file.sticker?.hint });
      } catch (err) {
        log.warn({ platform, err: errorMessage(err, 200) }, "sticker not kept");
        return undefined;
      }
    }
    if (s.meaning || !naming) return s;
    const named = name(s, threadId);
    const late = new Promise<Sticker>((r) => setTimeout(r, NAME_WAIT_MS, s).unref?.());
    return Promise.race([named, late]);
  }

  /** Names a sticker once (a second arrival while it is being named waits for the same call). */
  function name(s: Sticker, threadId?: string): Promise<Sticker> {
    const going = pending.get(s.id);
    if (going) return going;
    const p = (async () => {
      const media = store.media.get(s.media_id);
      let meaning: string | undefined;
      if (media?.mime.startsWith("image/") && deps.see) {
        const data = fs.readFileSync(media.path, "base64");
        const language = store.settings.get("owner_language") === "en" ? "English" : "Spanish";
        const hint = s.hint ? `The platform says it stands for ${s.hint}.` : "Name this sticker.";
        meaning = await deps
          .see(NAME_PROMPT(language), hint, { mime: media.mime, data }, { purpose: "sticker", thread_id: threadId })
          .catch((err: unknown) => {
            log.warn({ sticker: s.id, err: errorMessage(err, 200) }, "sticker not named");
            return undefined;
          });
      }
      // An animated sticker (or no model that reads images): what the platform says it stands for.
      const words = meaning?.replace(/^["'«\s]+|["'».\s]+$/g, "") || s.hint;
      if (words) store.stickers.describe(s.id, words);
      return store.stickers.get(s.id) ?? s;
    })().finally(() => pending.delete(s.id));
    pending.set(s.id, p);
    return p;
  }

  /** The sticker of this platform whose meaning best fits the agent's words; none below half of them. */
  function find(platform: string, words: string): Sticker | undefined {
    const all = store.stickers.known(platform, 500);
    const q = flat(words);
    // Only an emoji: the sticker that stands for it.
    if (!q) return all.find((s) => s.hint === words.trim());
    const exact = all.find((s) => flat(s.meaning ?? "").includes(q));
    if (exact) return exact;
    const wanted = q.split(" ").filter((w) => w.length > 2);
    if (!wanted.length) return undefined;
    let best: Sticker | undefined;
    let score = 0;
    for (const s of all) {
      const m = flat(s.meaning ?? "");
      const hits = wanted.filter((w) => m.includes(w)).length;
      // Sending the wrong sticker is worse than sending none.
      if (hits > score && hits >= Math.ceil(wanted.length / 2)) [best, score] = [s, hits];
    }
    return best;
  }

  return { keep, find };
}

export type Stickers = ReturnType<typeof createStickers>;

/** Lowercase words without accents or punctuation. */
const flat = (s: string) =>
  s
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();

/** "STICKER oso con corazón": the agent answers with the sticker whose meaning fits those words. */
export function stickerAnswer(text: string): string | undefined {
  const m = /^\W*STICKER\W*?:?\s+([^\n]{1,120})$/iu.exec(text.trim());
  return m?.[1]?.replace(/[*_`"]/g, "").trim() || undefined;
}
