// The phones that take part in errands on the way (rules/ERRANDS_ON_THE_WAY.md#phones). A phone turns itself on or
// off; the owner turns one off from APX, which ends its trip here and switches the phone off on its next point.
import { randomUUID } from "node:crypto";
import type { CarPhone } from "@apx/protocol";
import type { Store } from "../domain/store.ts";
import { badRequest, notFound } from "../errors.ts";

export function createPhones(store: Store, now: () => Date, changed: () => void) {
  const view = (deviceId: string): CarPhone | undefined => {
    const row = store.carPhones.get(deviceId);
    const device = store.devices.get(deviceId);
    if (!row || !device) return undefined;
    const active = store.carTrips.active();
    const trip = active?.device_id === deviceId ? active : undefined;
    return {
      device_id: deviceId,
      name: device.name,
      enabled: row.enabled,
      changed_at: row.changed_at,
      changed_by: row.changed_by,
      ...(device.last_seen_at ? { last_seen_at: device.last_seen_at } : {}),
      ...(trip ? { trip: { id: trip.id, source: trip.source, started_at: trip.started_at } } : {}),
    };
  };

  /** Ends this phone's open trip: the owner turned it off, so it must not keep one alive here. */
  const endTripOf = (deviceId: string) => {
    const active = store.carTrips.active();
    if (active?.device_id !== deviceId) return;
    store.settings.set(`car_revoked:${active.id}`, "1");
    store.carTrips.end(active.id, now().toISOString());
  };

  return {
    revision: (deviceId: string | undefined): string =>
      deviceId ? (store.settings.get(`car_phone_consent:${deviceId}`) ?? "initial") : "initial",
    list(): CarPhone[] {
      return store.carPhones.list().flatMap((row) => view(row.device_id) ?? []);
    },
    /** Whether a phone may start or keep a trip: one never seen before may, and is listed from then on. */
    allows(deviceId: string | undefined): boolean {
      if (!deviceId) return true;
      const row = store.carPhones.get(deviceId);
      if (row) return row.enabled;
      store.carPhones.set(deviceId, true, "phone", now().toISOString());
      return true;
    },
    thisPhone(deviceId: string | undefined): boolean | undefined {
      return deviceId ? (store.carPhones.get(deviceId)?.enabled ?? true) : undefined;
    },
    /** A phone sets itself; the owner may only turn another one off. */
    set(p: { enabled: boolean; device_id?: string | undefined }, caller: string | undefined): CarPhone {
      const own = p.device_id === undefined || p.device_id === caller;
      const id = p.device_id ?? caller;
      if (!id) throw badRequest("Say which phone: this call does not come from one");
      if (!store.devices.get(id)) throw notFound("phone");
      if (!own && p.enabled) throw badRequest("Only the phone itself turns errands on");
      store.carPhones.set(id, p.enabled, own ? "phone" : "owner", now().toISOString());
      if (!p.enabled) {
        store.settings.set(`car_phone_consent:${id}`, randomUUID());
        endTripOf(id);
      }
      changed();
      const phone = view(id);
      if (!phone) throw notFound("phone");
      return phone;
    },
  };
}
