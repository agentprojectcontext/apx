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
import type { CallContext } from "./context.ts";

export type Handler<M extends MethodName> = (params: Params<M>, ctx: CallContext) => Promise<Result<M>> | Result<M>;
export type Handlers = { [M in MethodName]: Handler<M> };

export type DispatchResult = { ok: true; result: unknown } | { ok: false; error: ApxErrorShape };

export function createRouter(handlers: Handlers) {
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
      return { ok: true, result: def.result.parse(result) };
    } catch (err) {
      ctx.log.error({ method, err: String(err) }, "handler failed");
      return {
        ok: false,
        error: { code: ErrorCode.Internal, message: err instanceof Error ? err.message : String(err) },
      };
    }
  };
}

export type Dispatch = ReturnType<typeof createRouter>;
