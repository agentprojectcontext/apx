// Moving from Hermes: preview what its home folder becomes in APX, then import exactly that.
import type { Store } from "../domain/store.ts";
import { badRequest } from "../errors.ts";
import { applyHermes, hermesHome, hermesPlan, shown } from "../import/hermes-import.ts";
import type { InternalCall } from "./internal.ts";

export function hermesHandlers(store: Store, call: InternalCall) {
  const plan = async (folder: string) => {
    const home = hermesHome(folder);
    const steps = await hermesPlan(store, call, home);
    if (!steps) throw badRequest(`no Hermes setup in ${home}`);
    return steps;
  };
  return {
    "hermes.preview": async ({ path: folder }: { path: string }) => ({ items: (await plan(folder)).map(shown) }),
    "hermes.import": async ({ path: folder }: { path: string }) => ({ items: await applyHermes(await plan(folder)) }),
  };
}
