// The owner's paired devices. A device's token is random and handed over once; only its sha256 is stored.
import { createHash, randomBytes } from "node:crypto";
import type { Device, DevicePlatform, PushTarget } from "@apx/protocol";
import { newId, now, opt, qb, type Sql } from "./sql.ts";

const hashOf = (token: string) => createHash("sha256").update(token).digest("hex");

type Row = {
  id: string;
  name: string;
  platform: string;
  created_at: string;
  last_seen_at: string | null;
  push: string | null;
};
const pushOf = (r: Row): PushTarget | undefined => {
  try {
    return r.push ? (JSON.parse(r.push) as PushTarget) : undefined;
  } catch {
    return undefined;
  }
};
const toDevice = (r: Row): Device => {
  const push = pushOf(r)?.kind;
  return {
    id: r.id,
    name: r.name,
    platform: r.platform as DevicePlatform,
    created_at: r.created_at,
    ...opt("last_seen_at", r.last_seen_at),
    ...(push ? { push } : {}),
  };
};

export function devicesRepo({ one, all, run }: Sql) {
  return {
    list(): Device[] {
      return all(qb.selectFrom("devices").selectAll().where("revoked_at", "is", null).orderBy("created_at")).map(
        toDevice,
      );
    },
    create(name: string, platform: DevicePlatform): { device: Device; token: string } {
      const id = newId("dev");
      const token = `apxd_${randomBytes(32).toString("base64url")}`;
      run(qb.insertInto("devices").values({ id, name, platform, token_hash: hashOf(token), created_at: now() }));
      const r = one(qb.selectFrom("devices").selectAll().where("id", "=", id));
      if (!r) throw new Error("device not stored");
      return { device: toDevice(r), token };
    },
    /** The live device a token belongs to (its use noted at most once a minute); undefined when unknown or revoked. */
    byToken(token: string): Device | undefined {
      if (!token.startsWith("apxd_")) return undefined;
      const r = one(
        qb.selectFrom("devices").selectAll().where("token_hash", "=", hashOf(token)).where("revoked_at", "is", null),
      );
      if (!r) return undefined;
      if (!r.last_seen_at || Date.now() - Date.parse(r.last_seen_at) > 60_000)
        run(qb.updateTable("devices").set({ last_seen_at: now() }).where("id", "=", r.id));
      return toDevice(r);
    },
    get(id: string): Device | undefined {
      const r = one(qb.selectFrom("devices").selectAll().where("id", "=", id).where("revoked_at", "is", null));
      return r ? toDevice(r) : undefined;
    },
    setPush(id: string, push: PushTarget | null): Device | undefined {
      run(
        qb
          .updateTable("devices")
          .set({ push: push ? JSON.stringify(push) : null })
          .where("id", "=", id),
      );
      return this.get(id);
    },
    /** Where a live device takes push notices. */
    pushTarget(id: string): PushTarget | undefined {
      const r = one(qb.selectFrom("devices").selectAll().where("id", "=", id).where("revoked_at", "is", null));
      return r ? pushOf(r) : undefined;
    },
    revoke(id: string): boolean {
      return (
        run(qb.updateTable("devices").set({ revoked_at: now() }).where("id", "=", id).where("revoked_at", "is", null)) >
        0
      );
    },
  };
}
