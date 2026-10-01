// Outside apps the owner connected. The token is random and shown once; only its sha256 is stored, so a copy of the
// database does not hand out access.
import { createHash, randomBytes } from "node:crypto";
import type { ApiClient, ClientScope } from "@apx/protocol";
import { newId, now, opt, qb, type Sql } from "./sql.ts";

const hashOf = (token: string) => createHash("sha256").update(token).digest("hex");

export function clientsRepo({ one, all, run }: Sql) {
  const toClient = (r: { id: string; name: string; scopes: string; created_at: string; last_used_at: string | null }) =>
    ({
      id: r.id,
      name: r.name,
      scopes: JSON.parse(r.scopes) as ClientScope[],
      created_at: r.created_at,
      ...opt("last_used_at", r.last_used_at),
    }) satisfies ApiClient;
  return {
    list(): ApiClient[] {
      return all(qb.selectFrom("api_clients").selectAll().where("revoked_at", "is", null).orderBy("created_at")).map(
        toClient,
      );
    },
    create(name: string, scopes: ClientScope[]): { client: ApiClient; token: string } {
      const id = newId("cli");
      const token = `apxc_${randomBytes(24).toString("hex")}`;
      run(
        qb.insertInto("api_clients").values({
          id,
          name,
          scopes: JSON.stringify([...new Set(scopes)]),
          token_hash: hashOf(token),
          created_at: now(),
        }),
      );
      const r = one(qb.selectFrom("api_clients").selectAll().where("id", "=", id));
      if (!r) throw new Error("client not stored");
      return { client: toClient(r), token };
    },
    /** The live client a token belongs to (and notes its use); undefined for an unknown or revoked token. */
    byToken(token: string): ApiClient | undefined {
      const r = one(
        qb
          .selectFrom("api_clients")
          .selectAll()
          .where("token_hash", "=", hashOf(token))
          .where("revoked_at", "is", null),
      );
      if (!r) return undefined;
      // Noted at most once a minute, not on every call.
      if (!r.last_used_at || Date.now() - Date.parse(r.last_used_at) > 60_000)
        run(qb.updateTable("api_clients").set({ last_used_at: now() }).where("id", "=", r.id));
      return toClient(r);
    },
    revoke(id: string): boolean {
      return (
        run(
          qb.updateTable("api_clients").set({ revoked_at: now() }).where("id", "=", id).where("revoked_at", "is", null),
        ) > 0
      );
    },
  };
}
