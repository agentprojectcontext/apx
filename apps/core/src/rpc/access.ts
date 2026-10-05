// access.*: who may reach this core (see access.ts).
import type { createAccess } from "../access.ts";
import type { Handlers } from "./router.ts";

export function accessHandlers(access: ReturnType<typeof createAccess>) {
  return {
    "access.get": () => access.state(),
    "access.set": ({ mode }) => access.set(mode),
  } satisfies Partial<Handlers>;
}
