// The first-run setup (setup.*): open on a new install, or from the account menu; v1's scan and import.
import type { Params, Result } from "@apx/protocol";
import { t } from "../i18n/index.ts";
import { client } from "./client.ts";
import { createStore, useSlice } from "./createStore.ts";
import { notify } from "./notices.ts";

type Status = Result<"setup.status">;
type State = { open: boolean; status: Status | undefined };
const store = createStore<State>({ open: false, status: undefined });

export const useSetup = <T>(select: (s: State) => T): T => useSlice(store, select);
const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** Reads where the setup is; a new install that never finished it opens it. */
export async function loadSetup(): Promise<void> {
  try {
    const status = await client.call("setup.status", {});
    store.set((s) => ({ status, open: s.open || (!status.done && status.fresh) }));
  } catch {
    // An older core has no setup: the panel opens as it always did.
  }
}

export const openSetup = () => store.set({ open: true });
export const closeSetup = () => store.set({ open: false });

export async function finishSetup(): Promise<void> {
  try {
    await client.call("setup.finish", {});
  } catch (e) {
    notify(t("error.change", { error: errText(e) }));
  }
  store.set((s) => ({ open: false, status: s.status ? { ...s.status, done: true } : s.status }));
}

export type V1Groups = Result<"setup.v1_scan">["groups"];
export type V1Group = V1Groups[number]["id"];

export async function scanV1(): Promise<V1Groups> {
  try {
    return (await client.call("setup.v1_scan", {})).groups;
  } catch (e) {
    notify(t("error.load", { error: errText(e) }));
    return [];
  }
}

export async function importV1(groups: Params<"setup.import_v1">["groups"]) {
  try {
    return await client.call("setup.import_v1", { groups });
  } catch (e) {
    notify(t("setup.import.failed", { error: errText(e) }));
    return undefined;
  }
}

/** A folder becomes a project (a plain one gets an AGENTS.md); its name, or nothing when it failed. */
export async function addProject(path: string): Promise<string | undefined> {
  try {
    return (await client.call("projects.register", { path, init: true })).project.name;
  } catch (e) {
    notify(t("error.change", { error: errText(e) }));
    return undefined;
  }
}
