// Model APIs the owner manages (providers.list / providers.set). Keys go to the core and never come back.
import type { ProviderInfo } from "@apx/protocol";
import { t } from "../i18n/index.ts";
import { client } from "./client.ts";
import { createStore, useSlice } from "./createStore.ts";
import { loadCatalog } from "./models.ts";
import { notify } from "./notices.ts";

type State = { list: ProviderInfo[]; load: "idle" | "loading" | "ready" | "error" };
const providers = createStore<State>({ list: [], load: "idle" });

export const useProviders = <T>(select: (s: State) => T): T => useSlice(providers, select);

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));

export async function loadProviders(): Promise<void> {
  providers.set((s) => ({ load: s.list.length ? s.load : "loading" }));
  try {
    providers.set({ list: (await client.call("providers.list", {})).providers, load: "ready" });
  } catch {
    providers.set({ load: "error" });
  }
}

export type ProviderDraft = {
  id: string;
  label: string;
  preset: string;
  transport: ProviderInfo["transport"];
  base_url: string;
  needs_key: boolean;
  models: string[];
  enabled: boolean;
};

/** Saves a provider (and its key when one was typed), then refreshes the model catalog so its models show up. */
export async function saveProvider(d: ProviderDraft, apiKey: string | undefined): Promise<boolean> {
  try {
    const r = await client.call("providers.set", {
      id: d.id,
      provider: {
        label: d.label,
        preset: d.preset,
        transport: d.transport,
        base_url: d.base_url,
        models: d.models,
        enabled: d.enabled,
        needs_key: d.needs_key,
      },
      ...(apiKey ? { api_key: apiKey } : {}),
    });
    providers.set({ list: r.providers });
    void loadCatalog(true);
    return true;
  } catch (e) {
    notify(t("error.saveProvider", { error: errText(e) }));
    return false;
  }
}

export async function removeProvider(id: string): Promise<void> {
  try {
    providers.set({ list: (await client.call("providers.set", { id, provider: null })).providers });
    void loadCatalog(true);
  } catch (e) {
    notify(t("error.saveProvider", { error: errText(e) }));
  }
}

export async function setProviderEnabled(p: ProviderInfo, enabled: boolean): Promise<void> {
  await saveProvider(
    {
      id: p.id,
      label: p.label,
      preset: p.preset ?? p.id,
      transport: p.transport,
      base_url: p.base_url,
      needs_key: p.needs_key,
      models: p.models,
      enabled,
    },
    undefined,
  );
}
