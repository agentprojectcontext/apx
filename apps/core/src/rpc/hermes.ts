// Moving from Hermes: preview what its home folder becomes in APX, then import exactly that.
import path from "node:path";
import type { Store } from "../domain/store.ts";
import { badRequest } from "../errors.ts";
import { applyHermes, hermesPlan, shown } from "../import/hermes-import.ts";
import { expandHome } from "../paths.ts";
import type { InternalCall } from "./internal.ts";

export function hermesHandlers(store: Store, call: InternalCall) {
  const plan = async (folder: string) => {
    const home = path.resolve(expandHome(folder));
    const steps = await hermesPlan(store, call, home);
    if (!steps) throw badRequest(`no Hermes setup in ${home}`);
    return steps;
  };
  return {
    "hermes.preview": async ({ path: folder }: { path: string }) => ({ items: (await plan(folder)).map(shown) }),
    "hermes.import": async ({ path: folder }: { path: string }) => ({ items: await applyHermes(await plan(folder)) }),
  };
}
