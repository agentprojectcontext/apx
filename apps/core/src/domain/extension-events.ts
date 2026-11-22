import { ExtensionEventConfig, type ExtensionEventInput } from "@apx/protocol";
import { sql } from "kysely";
import { newId, qb, type Sql } from "./sql.ts";

export function extensionEventsRepo({ one, all, run, tx }: Sql) {
  return {
    config(extension: string) {
      const row = one(qb.selectFrom("extension_event_configs").selectAll().where("extension", "=", extension));
      return row ? { ...row, config: ExtensionEventConfig.parse(JSON.parse(row.config)) } : undefined;
    },
    configure(extension: string, generation: string, config: ExtensionEventConfig) {
      const revision = newId("ec");
      run(
        qb
          .insertInto("extension_event_configs")
          .values({ extension, generation, revision, config: JSON.stringify(config), error: null })
          .onConflict((c) =>
            c.column("extension").doUpdateSet({ generation, revision, config: JSON.stringify(config), error: null }),
          ),
      );
    },
    error(extension: string, error: string | null) {
      run(qb.updateTable("extension_event_configs").set({ error }).where("extension", "=", extension));
    },
    get(receipt: string) {
      return one(qb.selectFrom("extension_events").selectAll().where("receipt", "=", receipt));
    },
    find(extension: string, generation: string, input: Pick<ExtensionEventInput, "event" | "id">) {
      return one(
        qb
          .selectFrom("extension_events")
          .selectAll()
          .where("extension", "=", extension)
          .where("generation", "=", generation)
          .where("event", "=", input.event)
          .where("external_id", "=", input.id),
      );
    },
    count(extension: string, since?: string) {
      let query = qb
        .selectFrom("extension_events")
        .select((eb) => eb.fn.countAll<number>().as("n"))
        .where("extension", "=", extension);
      if (since) query = query.where("created_at", ">=", since);
      return Number(one(query)?.n ?? 0);
    },
    add(
      extension: string,
      generation: string,
      revision: string,
      thread: string,
      input: ExtensionEventInput,
      at: string,
    ) {
      const receipt = newId("ev");
      run(
        qb.insertInto("extension_events").values({
          receipt,
          extension,
          generation,
          revision,
          thread,
          event: input.event,
          external_id: input.id,
          data: JSON.stringify(input.data),
          state: "pending",
          created_at: at,
          run_id: null,
        }),
      );
      return receipt;
    },
    pending(extension?: string) {
      let query = qb.selectFrom("extension_events").selectAll().where("state", "=", "pending");
      if (extension) query = query.where("extension", "=", extension);
      return all(query.orderBy("created_at").limit(100));
    },
    pendingCount(extension: string) {
      return Number(
        one(
          qb
            .selectFrom("extension_events")
            .select((eb) => eb.fn.countAll<number>().as("n"))
            .where("extension", "=", extension)
            .where("state", "=", "pending"),
        )?.n ?? 0,
      );
    },
    revoke(extension: string) {
      tx(() => {
        run(
          qb
            .updateTable("extension_event_configs")
            .set({ config: sql<string>`json_set(config, '$.enabled', json('false'))`, revision: newId("ec") })
            .where("extension", "=", extension),
        );
        run(
          qb
            .updateTable("extension_events")
            .set({ state: "canceled" })
            .where("extension", "=", extension)
            .where("state", "=", "pending"),
        );
      });
    },
    compact(before: string, extension?: string) {
      let query = qb.deleteFrom("extension_events").where("state", "!=", "pending").where("created_at", "<", before);
      if (extension) query = query.where("extension", "=", extension);
      run(query);
    },
    expire(before: string) {
      run(
        qb
          .updateTable("extension_events")
          .set({ state: "canceled" })
          .where("state", "=", "pending")
          .where("created_at", "<", before),
      );
    },
    cancel(extension: string) {
      run(
        qb
          .updateTable("extension_events")
          .set({ state: "canceled" })
          .where("extension", "=", extension)
          .where("state", "=", "pending"),
      );
    },
    admitted(receipt: string, run_id: string) {
      run(
        qb
          .updateTable("extension_events")
          .set({ state: "admitted", run_id })
          .where("receipt", "=", receipt)
          .where("state", "=", "pending"),
      );
    },
  };
}
