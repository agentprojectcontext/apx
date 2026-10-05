// A project's areas and roles (org.get / org.set), per project; the base project's under its nav id.
import type { Organization } from "@apx/protocol";
import { useEffect } from "react";
import { t } from "../i18n/index.ts";
import { client } from "./client.ts";
import { createStore, useSlice } from "./createStore.ts";
import { realProjectId } from "./identity.ts";
import { notify } from "./notices.ts";

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));
const store = createStore<{ orgs: Record<string, Organization> }>({ orgs: {} });

export async function loadOrg(pid: string): Promise<void> {
  try {
    const project = realProjectId(pid);
    const org = await client.call("org.get", project ? { project } : {});
    store.set((s) => ({ orgs: { ...s.orgs, [pid]: org } }));
  } catch (e) {
    notify(t("error.load", { error: errText(e) }));
  }
}

/** Replaces the project's areas and roles; true when the core took them. */
export async function saveOrg(pid: string, organization: Organization): Promise<boolean> {
  try {
    const project = realProjectId(pid);
    const org = await client.call("org.set", { organization, ...(project ? { project } : {}) });
    store.set((s) => ({ orgs: { ...s.orgs, [pid]: org } }));
    return true;
  } catch (e) {
    notify(t("error.save", { error: errText(e) }));
    return false;
  }
}

/** The project's areas and roles, loaded on first use; undefined while loading. */
export function useOrg(pid: string): Organization | undefined {
  const org = useSlice(store, (s) => s.orgs[pid]);
  useEffect(() => {
    if (!store.get().orgs[pid]) void loadOrg(pid);
  }, [pid]);
  return org;
}
