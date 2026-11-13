// Pairing the owner's devices: the panel asks for a one-time code (shown as a QR with the core's addresses), the device
// trades it for a token of its own. Codes last 10 minutes, stored as hashes so one still on screen survives a restart;
// too many wrong ones void them all for a while, so a code cannot be guessed from the network.
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
  const typedCode = (code: string) => store.devices.codeHash(code.toUpperCase().replace(/[\s-]/g, ""));
  const newCode = () => Array.from({ length: CODE_LEN }, () => ALPHABET[randomInt(ALPHABET.length)]).join("");
  /** The stored state without the codes that ran out. */
  const pending = () => {
    const state = store.devices.pairing();
    for (const [c, until] of Object.entries(state.codes)) if (until <= clock()) delete state.codes[c];
    return state;
  };

  return {
    "devices.pair_start": () => {
      const state = pending();
      const code = newCode();
      const until = clock() + CODE_TTL_MS;
      state.codes[typedCode(code)] = until;
      store.devices.savePairing(state);
      return { code, expires_at: new Date(until).toISOString(), urls: opts.addresses() };
    },
    "devices.pair_cancel": ({ code }) => {
      const state = pending();
      const hash = typedCode(code);
      const canceled = hash in state.codes;
      delete state.codes[hash];
      store.devices.savePairing(state);
      return { canceled };
    },
    "devices.pair": ({ code, name, platform }) => {
      const state = pending();
      if (clock() < state.locked_until)
        throw new CallError({
          code: "unauthorized",
          message: "too many wrong codes: ask for a new one in a few minutes",
        });
      const hash = typedCode(code);
      if (!(hash in state.codes)) {
        if (++state.misses >= MAX_MISSES) {
          state.codes = {};
          state.misses = 0;
          state.locked_until = clock() + LOCKOUT_MS;
        }
        store.devices.savePairing(state);
        throw new CallError({ code: "unauthorized", message: "unknown or expired code" });
      }
      delete state.codes[hash];
      state.misses = 0;
      store.devices.savePairing(state);
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
