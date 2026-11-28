// Which paired phones take part in errands on the way. The phone turns itself on or off; the owner can turn one off
// from APX, which the phone learns on its next point (rules/ERRANDS_ON_THE_WAY.md#phones).
import type { Selectable } from "kysely";
import type { CarPhonesTable } from "../db/schema.ts";
import { qb, type Sql } from "./sql.ts";

export type CarPhoneRow = { device_id: string; enabled: boolean; changed_at: string; changed_by: "phone" | "owner" };

const toRow = (r: Selectable<CarPhonesTable>): CarPhoneRow => ({
  device_id: r.device_id,
  enabled: r.enabled === 1,
  changed_at: r.changed_at,
  changed_by: r.changed_by === "owner" ? "owner" : "phone",
});

export function carPhonesRepo({ one, all, run }: Sql) {
  return {
    get(deviceId: string): CarPhoneRow | undefined {
      const r = one(qb.selectFrom("car_phones").selectAll().where("device_id", "=", deviceId));
      return r ? toRow(r) : undefined;
    },
    list(): CarPhoneRow[] {
      return all(qb.selectFrom("car_phones").selectAll().orderBy("changed_at", "desc")).map(toRow);
    },
    set(deviceId: string, enabled: boolean, by: CarPhoneRow["changed_by"], at: string): CarPhoneRow {
      const values = { enabled: enabled ? 1 : 0, changed_at: at, changed_by: by };
      run(
        qb
          .insertInto("car_phones")
          .values({ device_id: deviceId, ...values })
          .onConflict((c) => c.column("device_id").doUpdateSet(values)),
      );
      return { device_id: deviceId, enabled, changed_at: at, changed_by: by };
    },
  };
}
