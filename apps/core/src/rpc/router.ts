// The single dispatcher. HTTP /rpc, the WS socket and (later) node links and agent tools
// all enter here — there is no second path into a handler.
import {
  type ApxErrorShape,
  ErrorCode,
  isMethodName,
  type MethodName,
  methods,
  type Params,
  type Result,
} from "@apx/protocol";
import { CallError } from "../errors.ts";
import type { CallContext } from "./context.ts";

export type Handler<M extends MethodName> = (params: Params<M>, ctx: CallContext) => Promise<Result<M>> | Result<M>;
export type Handlers = { [M in MethodName]: Handler<M> };

export type DispatchResult = { ok: true; result: unknown } | { ok: false; error: ApxErrorShape };

/** Remembers the answer to a side-effect call so a retried request with the same key gets it, not a second effect. */
export type IdemStore = {
  get(key: string, method: string): unknown | undefined;
  put(key: string, method: string, response: unknown): void;
};

export function createRouter(handlers: Handlers, idemStore?: IdemStore) {
  return async function dispatch(
    method: string,
    rawParams: unknown,
    ctx: CallContext,
    idem?: string,
  ): Promise<DispatchResult> {
    if (!isMethodName(method)) {
      return { ok: false, error: { code: ErrorCode.UnknownMethod, message: `unknown method: ${method}` } };
    }
    const def = methods[method];
    if (def.effect && !idem) {
      return { ok: false, error: { code: ErrorCode.BadRequest, message: `${method} requires an idempotency key` } };
    }
    if (def.effect && idem && idemStore) {
      const seen = idemStore.get(idem, method);
      if (seen !== undefined) return { ok: true, result: seen };
    }
    const parsed = def.params.safeParse(rawParams ?? {});
    if (!parsed.success) {
      return {
        ok: false,
        error: { code: ErrorCode.BadRequest, message: "invalid params", detail: parsed.error.issues },
      };
    }
    try {
      const handler = handlers[method] as Handler<typeof method>;
      const result = await handler(parsed.data as never, ctx);
      const out = def.result.parse(result);
      if (def.effect && idem && idemStore) idemStore.put(idem, method, out);
      return { ok: true, result: out };
    } catch (err) {
      if (err instanceof CallError) return { ok: false, error: err.shape };
      ctx.log.error({ method, err: String(err) }, "handler failed");
      return {
        ok: false,
        error: { code: ErrorCode.Internal, message: err instanceof Error ? err.message : String(err) },
      };
    }
  };
}

export type Dispatch = ReturnType<typeof createRouter>;
