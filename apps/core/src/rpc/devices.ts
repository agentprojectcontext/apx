// Pairing the owner's devices: the panel asks for a one-time code (shown as a QR with the core's addresses), the device
// trades it for a token of its own. Codes live in memory for 10 minutes; too many wrong ones void them all for a while,
// so a code cannot be guessed from the network.
import { randomInt } from "node:crypto";
import type { Store } from "../domain/store.ts";
import { CallError } from "../errors.ts";
import type { Handlers } from "./router.ts";

const CODE_TTL_MS = 10 * 60_000;
/** Wrong codes allowed before every pending code is voided and pairing pauses. */
const MAX_MISSES = 5;
const LOCKOUT_MS = 5 * 60_000;
/** No 0/O, 1/I/L: a code read off a screen is typed without doubt. */
const ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";
const CODE_LEN = 8;

export function deviceHandlers(
  store: Store,
  opts: { addresses: () => string[]; clock?: () => number; onRevoke?: (id: string) => void } = { addresses: () => [] },
) {
  const clock = opts.clock ?? Date.now;
  const codes = new Map<string, number>();
  let misses = 0;
  let lockedUntil = 0;

  const newCode = () => Array.from({ length: CODE_LEN }, () => ALPHABET[randomInt(ALPHABET.length)]).join("");
  const sweep = () => {
    for (const [c, until] of codes) if (until <= clock()) codes.delete(c);
  };

  return {
    "devices.pair_start": () => {
      sweep();
      const code = newCode();
      const until = clock() + CODE_TTL_MS;
      codes.set(code, until);
      return { code, expires_at: new Date(until).toISOString(), urls: opts.addresses() };
    },
    "devices.pair_cancel": ({ code }) => ({ canceled: codes.delete(code.toUpperCase().replace(/[\s-]/g, "")) }),
    "devices.pair": ({ code, name, platform }) => {
      sweep();
      if (clock() < lockedUntil)
        throw new CallError({
          code: "unauthorized",
          message: "too many wrong codes: ask for a new one in a few minutes",
        });
      const typed = code.toUpperCase().replace(/[\s-]/g, "");
      if (!codes.has(typed)) {
        if (++misses >= MAX_MISSES) {
          codes.clear();
          misses = 0;
          lockedUntil = clock() + LOCKOUT_MS;
        }
        throw new CallError({ code: "unauthorized", message: "unknown or expired code" });
      }
      codes.delete(typed);
      misses = 0;
      return store.devices.create(name, platform);
    },
    "devices.list": () => ({ devices: store.devices.list() }),
    "devices.set_push": ({ id, push }, ctx) => {
      // A device sets its own; the owner, from the panel, names the device. Nobody else.
      const target = ctx.device?.id ?? (ctx.actor === "human" && !ctx.client && !ctx.agent ? id : undefined);
      if (!target)
        throw new CallError({ code: "unauthorized", message: "only a paired device, or the owner, sets push" });
      if (ctx.device && id && id !== ctx.device.id)
        throw new CallError({ code: "unauthorized", message: "a device sets only its own push" });
      const device = store.devices.setPush(target, push);
      if (!device) throw new CallError({ code: "not_found", message: `device ${target} not found` });
      return device;
    },
    "devices.revoke": ({ id }) => {
      const revoked = store.devices.revoke(id);
      if (revoked) opts.onRevoke?.(id);
      return { revoked };
    },
  } satisfies Partial<Handlers>;
}
