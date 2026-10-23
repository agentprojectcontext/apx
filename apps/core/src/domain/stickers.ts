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
  /** The owner said the agent may not send it. */
  blocked: boolean;
  /** Waits for the owner's OK before the agent may send it. */
  pending: boolean;
  /** A model saw it as adult-only: never sent without the owner's OK. */
  adult: boolean;
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
  blocked: Boolean(r.blocked),
  pending: Boolean(r.pending),
  adult: Boolean(r.adult),
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
    /** Stickers kept without a meaning (no model could see them when they came), oldest first. */
    unnamed(limit = 50): Sticker[] {
      return all(
        qb.selectFrom("stickers").selectAll().where("meaning", "is", null).orderBy("created_at").limit(limit),
      ).map(toSticker);
    },
    /** A platform's stickers, the most used first, named or not, blocked or not (what the owner manages). */
    list(platform: string): Sticker[] {
      return all(
        qb
          .selectFrom("stickers")
          .selectAll()
          .where("platform", "=", platform)
          .orderBy((eb) => eb("seen", "+", eb.ref("sent")), "desc")
          .orderBy("last_at", "desc"),
      ).map(toSticker);
    },
    /** The owner's words for it, or their decision: allowed or blocked, either way no longer waiting. */
    set(id: string, patch: { meaning?: string | undefined; blocked?: boolean | undefined }): Sticker | undefined {
      if (patch.meaning !== undefined) repo.describe(id, patch.meaning);
      if (patch.blocked !== undefined)
        run(
          qb
            .updateTable("stickers")
            .set({ blocked: patch.blocked ? 1 : 0, pending: 0 })
            .where("id", "=", id),
        );
      return repo.get(id);
    },
    /** Once named: whether it waits for the owner's OK, and whether it is adult-only. */
    review(id: string, r: { pending: boolean; adult: boolean }): void {
      run(
        qb
          .updateTable("stickers")
          .set({ pending: r.pending ? 1 : 0, adult: r.adult ? 1 : 0 })
          .where("id", "=", id),
      );
    },
    /** Forgets a sticker; its media row and file are the caller's to remove. */
    remove(id: string): boolean {
      return run(qb.deleteFrom("stickers").where("id", "=", id)) > 0;
    },
    /** A platform's stickers the agent may send (named, allowed, not waiting), the most used first. */
    known(platform: string, limit = 50): Sticker[] {
      return all(
        qb
          .selectFrom("stickers")
          .selectAll()
          .where("platform", "=", platform)
          .where("meaning", "is not", null)
          .where("blocked", "=", 0)
          .where("pending", "=", 0)
          .orderBy((eb) => eb("seen", "+", eb.ref("sent")), "desc")
          .orderBy("last_at", "desc")
          .limit(limit),
      ).map(toSticker);
    },
  };
  return repo;
}
