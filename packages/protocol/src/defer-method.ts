import type { z } from "zod";
import type { MethodDef } from "./methods.ts";

type DeferredMethod = Omit<MethodDef, "params" | "result"> & {
  params: () => z.ZodType;
  result: () => z.ZodType;
};

/** Keep authorization metadata available without constructing unused validation schemas. */
export function deferMethod<const D extends DeferredMethod>(definition: D) {
  const { params: makeParams, result: makeResult, ...metadata } = definition;
  let params: z.ZodType | undefined;
  let result: z.ZodType | undefined;
  return {
    ...metadata,
    get params() {
      params ??= makeParams();
      return params as ReturnType<D["params"]>;
    },
    get result() {
      result ??= makeResult();
      return result as ReturnType<D["result"]>;
    },
  };
}
