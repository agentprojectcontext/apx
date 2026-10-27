// The single dispatcher. HTTP /rpc, the WS socket and agent-side clients all enter here — there is no second path
// into a handler. Access, params, result shape and idempotency are checked here, not in each handler.
import {
  type ApxErrorShape,
  ErrorCode,
  isMethodName,
  type MethodDef,
  type MethodName,
  methodAccess,
  methods,
  type ParsedParams,
  type Result,
  SCOPE_METHODS,
} from "@apx/protocol";
import { CallError, errorMessage } from "../errors.ts";
import type { CallContext } from "./context.ts";

export type Handler<M extends MethodName> = (
  params: ParsedParams<M>,
  ctx: CallContext,
) => Promise<Result<M>> | Result<M>;
export type Handlers = { [M in MethodName]: Handler<M> };

export type DispatchResult = { ok: true; result: unknown } | { ok: false; error: ApxErrorShape };

/** Remembers the answer to a side-effect call so a retried request with the same key gets it, not a second effect. */
export type IdemStore = {
  get(key: string, method: string): unknown | undefined;
  put(key: string, method: string, response: unknown): void;
};

const RETRYABLE = new Set<string>([ErrorCode.Timeout, ErrorCode.Unavailable]);

/** Methods a node connection may call: it lends capabilities, it does not operate the core. */
export const NODE_METHODS: ReadonlySet<string> = new Set(["system.health", "system.ping"]);

export function createRouter(handlers: Handlers, idemStore?: IdemStore) {
  /** Effect calls in progress by key: a concurrent retry joins the first call instead of running it twice. */
  const inFlight = new Map<string, Promise<DispatchResult>>();

  async function invoke(
    method: MethodName,
    rawParams: unknown,
    ctx: CallContext,
    idem?: string,
  ): Promise<DispatchResult> {
    const def = methods[method];
    const params = rawParams ?? {};
    // Boolean validation avoids collecting every type error from attacker-controlled arrays.
    if (!def.params.validate(params)) {
      return { ok: false, error: { code: ErrorCode.BadRequest, message: "invalid params" } };
    }
    const parsed = def.params.safeParse(params);
    if (!parsed.success) {
      return { ok: false, error: { code: ErrorCode.BadRequest, message: "invalid params" } };
    }
    try {
      const handler = handlers[method] as Handler<typeof method>;
      const out = def.result.parse(await handler(parsed.data as never, ctx));
      if (def.effect && idem && idemStore && (def as MethodDef).replay !== false) idemStore.put(idem, method, out);
      return { ok: true, result: out };
    } catch (err) {
      if (err instanceof CallError) {
        const shape = err.shape;
        return { ok: false, error: { ...shape, retryable: shape.retryable ?? RETRYABLE.has(shape.code) } };
      }
      ctx.log.error({ method, err: String(err) }, "handler failed");
      return {
        ok: false,
        error: {
          code: ErrorCode.Internal,
          message: errorMessage(err),
          retryable: false,
        },
      };
    }
  }

  return async function dispatch(
    method: string,
    rawParams: unknown,
    ctx: CallContext,
    idem?: string,
  ): Promise<DispatchResult> {
    if (!isMethodName(method)) {
      return { ok: false, error: { code: ErrorCode.UnknownMethod, message: `unknown method: ${method}` } };
    }
    if (ctx.role === "node" && !NODE_METHODS.has(method)) {
      return { ok: false, error: { code: ErrorCode.Unauthorized, message: `${method} is not available to nodes` } };
    }
    if (ctx.client && !ctx.client.scopes.some((sc) => SCOPE_METHODS[sc].includes(method))) {
      return {
        ok: false,
        error: { code: ErrorCode.Unauthorized, message: `${method} is outside what ${ctx.client.name} may do` },
      };
    }
    if (methodAccess(method) === "human" && ctx.actor !== "human") {
      return { ok: false, error: { code: ErrorCode.Unauthorized, message: `${method} is reserved to the owner` } };
    }
    const def = methods[method];
    if ((def as MethodDef).local && !ctx.local) {
      return {
        ok: false,
        error: { code: ErrorCode.Unauthorized, message: `${method} requires a direct local connection` },
      };
    }
    if (!def.effect) return invoke(method, rawParams, ctx);
    if (!idem) {
      return { ok: false, error: { code: ErrorCode.BadRequest, message: `${method} requires an idempotency key` } };
    }
    // A key replays only for the caller that used it: another caller's answer is never handed out.
    idem = `${ctx.client?.id ?? ctx.agent?.run_id ?? ctx.actor}:${idem}`;
    const seen = idemStore?.get(idem, method);
    if (seen !== undefined) return { ok: true, result: seen };
    const key = `${method}\u0000${idem}`;
    const running = inFlight.get(key);
    if (running) return running;
    const p = invoke(method, rawParams, ctx, idem).finally(() => inFlight.delete(key));
    inFlight.set(key, p);
    return p;
  };
}

export type Dispatch = ReturnType<typeof createRouter>;
