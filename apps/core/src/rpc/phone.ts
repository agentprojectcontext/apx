// The owner's phone as a node: where it is, and a picture the owner takes there. The core only routes; a photo comes
// back as bytes and is kept as media like an upload.
import { PHONE_CAMERA_CAP, PHONE_LOCATION_CAP } from "@apx/protocol";
import type { Store } from "../domain/store.ts";
import { CallError } from "../errors.ts";
import type { NodeBroker } from "../nodes/broker.ts";
import { saveUpload } from "../services/uploads.ts";
import type { Handlers } from "./router.ts";

/** Under the client's default: a phone answers fast or not at all. */
const LOCATION_MS = 12_000;
/** The owner has to frame and take the picture. */
const PHOTO_MS = 90_000;

export function phoneHandlers(broker: NodeBroker, store: Store, home: string) {
  return {
    "phone.location": async () =>
      (await broker.invoke(PHONE_LOCATION_CAP, "phone.location", {}, LOCATION_MS)) as {
        lat: number;
        lon: number;
        accuracy_m?: number;
        at: string;
      },
    "phone.photo": async ({ reason, thread }) => {
      const r = (await broker.invoke(PHONE_CAMERA_CAP, "phone.photo", reason ? { reason } : {}, PHOTO_MS)) as {
        mime?: string;
        data?: string;
      };
      if (!r?.data || !r.mime) throw new CallError({ code: "conflict", message: "no picture was taken" });
      try {
        const m = saveUpload(home, store, {
          name: "phone.jpg",
          mime: r.mime,
          bytes: Buffer.from(r.data, "base64"),
          thread,
        });
        return { media: { id: m.id, mime: m.mime } };
      } catch (err) {
        throw new CallError({ code: "bad_request", message: err instanceof Error ? err.message : String(err) });
      }
    },
  } satisfies Partial<Handlers>;
}
