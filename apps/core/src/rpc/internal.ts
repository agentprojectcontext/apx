// Calls into the router from inside the core: tools as their agent, channels as the owner or a contact. The same
// door every client uses, with a context built here that no request can forge.
import { type Actor, type MethodName, methods, type Params, type Result } from "@apx/protocol";
import { CallError } from "../errors.ts";
import type { Log } from "../log.ts";
import type { CallContext } from "./context.ts";
import type { Dispatch } from "./router.ts";

export type InternalCall = <M extends MethodName>(
  method: M,
  params: Params<M>,
  /** Who is calling is always said explicitly: nothing calls as the owner by default. */
  ctx: Partial<CallContext> & { actor: Actor },
  /** Idempotency key for a side-effect method; in-process calls are never retried by a transport. */
  key?: string,
) => Promise<Result<M>>;

/** `dispatch` is late-bound: the router exists only after the engine and the channels it serves. */
export function internalCaller(dispatch: () => Dispatch | undefined, log: Log): InternalCall {
  return async (method, params, ctx, key) => {
    const d = dispatch();
    if (!d) throw new Error("the router is not ready");
    const r = await d(
      method,
      params,
      { transport: "internal", role: "operator", session: undefined, log, ...ctx },
      methods[method].effect ? (key ?? `internal:${method}:${crypto.randomUUID()}`) : undefined,
    );
    if (!r.ok) throw new CallError(r.error);
    return r.result as Result<typeof method>;
  };
}
