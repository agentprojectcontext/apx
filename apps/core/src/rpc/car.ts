import type { Car } from "../car/service.ts";
import type { Handlers } from "./router.ts";

export function carHandlers(car: Car) {
  return {
    "car.settings": () => car.status(),
    "car.configure": (patch) => car.configure(patch),
    "car.trip_start": ({ trip_id, source, destination, at }, ctx) =>
      car.tripStart({
        trip_id,
        source,
        at,
        ...(destination ? { destination } : {}),
        ...(ctx.device ? { device_id: ctx.device.id } : {}),
      }),
    "car.position": (p) => car.position(p),
    "car.trip_end": ({ trip_id, at }) => car.tripEnd(trip_id, at),
    "car.trip": () => car.trip(),
    "car.answer": ({ alert_id, action }) => car.answer(alert_id, action),
    "car.errand": ({ task_id, action }) => car.errand(task_id, action),
    "car.places": ({ limit }) => ({ places: car.places(limit) }),
    "car.place_choice": ({ key, choice }) => car.placeChoice(key, choice),
    "car.preview": async (p) => ({ errands: await car.preview(p) }),
  } satisfies Partial<Handlers>;
}
