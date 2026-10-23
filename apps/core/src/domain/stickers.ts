// Stickers people sent on a channel: one row per platform and file (its bytes' hash, the same from anyone who sends
// it), with what it means, so the agent reads a sticker as words and can answer with one. Each platform keeps its
// own: a Telegram sticker is not a WhatsApp one. The file is a media row of its own, kept with the sticker.
import type { Selectable } from "kysely";
import type { StickersTable } from "../db/schema.ts";
import { newId, now, opt, qb, type Sql } from "./sql.ts";

export type Sticker = {
  id: string;
  platform: string;
  hash: string;
  media_id: string;
  /** What it shows and says, in a few words; none until a model that reads images named it. */
  meaning?: string | undefined;
  /** What the platform says of it (the emoji a Telegram sticker stands for). */
  hint?: string | undefined;
  /** Times it arrived, and times the agent sent it. */
  seen: number;
  sent: number;
  created_at: string;
  last_at: string;
};

const toSticker = (r: Selectable<StickersTable>): Sticker => ({
  id: r.id,
  platform: r.platform,
  hash: r.hash,
  media_id: r.media_id,
  ...opt("meaning", r.meaning),
  ...opt("hint", r.hint),
  seen: Number(r.seen),
  sent: Number(r.sent),
  created_at: r.created_at,
  last_at: r.last_at,
});

export function stickersRepo({ one, all, run }: Sql) {
  const repo = {
    get(id: string): Sticker | undefined {
      const r = one(qb.selectFrom("stickers").selectAll().where("id", "=", id));
      return r ? toSticker(r) : undefined;
    },
    byHash(platform: string, hash: string): Sticker | undefined {
      const r = one(qb.selectFrom("stickers").selectAll().where("platform", "=", platform).where("hash", "=", hash));
      return r ? toSticker(r) : undefined;
    },
    /** A sticker seen for the first time; the one already kept when the same file came meanwhile. */
    add(s: { platform: string; hash: string; media_id: string; hint?: string | undefined }): Sticker {
      const at = now();
      run(
        qb
          .insertInto("stickers")
          .values({
            id: newId("stk"),
            platform: s.platform,
            hash: s.hash,
            media_id: s.media_id,
            hint: s.hint?.slice(0, 40) ?? null,
            created_at: at,
            last_at: at,
          })
          .onConflict((oc) => oc.columns(["platform", "hash"]).doNothing()),
      );
      return repo.byHash(s.platform, s.hash) as Sticker;
    },
    seenAgain(id: string): void {
      run(
        qb
          .updateTable("stickers")
          .set((eb) => ({ seen: eb("seen", "+", 1), last_at: now() }))
          .where("id", "=", id),
      );
    },
    sentOnce(id: string): void {
      run(
        qb
          .updateTable("stickers")
          .set((eb) => ({ sent: eb("sent", "+", 1), last_at: now() }))
          .where("id", "=", id),
      );
    },
    describe(id: string, meaning: string): void {
      run(
        qb
          .updateTable("stickers")
          .set({ meaning: meaning.slice(0, 160) })
          .where("id", "=", id),
      );
    },
    /** A platform's stickers that have a meaning, the most used first. */
    known(platform: string, limit = 50): Sticker[] {
      return all(
        qb
          .selectFrom("stickers")
          .selectAll()
          .where("platform", "=", platform)
          .where("meaning", "is not", null)
          .orderBy((eb) => eb("seen", "+", eb.ref("sent")), "desc")
          .orderBy("last_at", "desc")
          .limit(limit),
      ).map(toSticker);
    },
  };
  return repo;
}
