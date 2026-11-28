// Telemetry (telemetry.*): what this install reports, and the owner's answer on usage statistics. Asked once: in the
// setup on a fresh install, by a corner card on one that predates it. See rules/DECISIONS.md#d-092.
import type { TelemetryState } from "@apx/protocol";
import { t } from "../i18n/index.ts";
import { client } from "./client.ts";
import { createStore, useSlice } from "./createStore.ts";
import { notify } from "./notices.ts";

type State = { state: TelemetryState | undefined };
const store = createStore<State>({ state: undefined });
let request = 0;
let changing = false;

export const useTelemetry = <T>(select: (s: State) => T): T => useSlice(store, select);

/** The page linked from every place that asks: what is sent, and what is not. */
export const PRIVACY_URL = "https://apxagent.app/reference/privacy/";

/** Says the panel opened (the `opened` step, once) and reads where telemetry stands. */
export async function loadTelemetry(): Promise<void> {
  try {
    await client.call("telemetry.seen", {});
    await refreshTelemetry();
  } catch {
    // An older core has no telemetry: nothing to ask.
  }
}

export async function refreshTelemetry(): Promise<void> {
  if (changing) return;
  const mine = ++request;
  try {
    const state = await client.call("telemetry.get", {});
    if (mine === request) store.set({ state });
  } catch {}
}

/** A Marketplace search settled: only how many it found reaches the core, and only with the owner's yes. */
export function noteSearch(results: number): void {
  if (store.get().state?.usage !== true) return;
  client.call("telemetry.note", { event: "marketplace_search", results }).catch(() => {
    // An older core does not count searches.
  });
}

export async function setUsage(usage: boolean): Promise<void> {
  if (changing) return;
  changing = true;
  request++;
  try {
    store.set({ state: await client.call("telemetry.set", { usage }) });
  } catch (e) {
    notify(t("error.change", { error: e instanceof Error ? e.message : String(e) }));
  } finally {
    changing = false;
  }
}
