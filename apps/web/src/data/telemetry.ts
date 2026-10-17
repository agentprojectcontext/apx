// Telemetry (telemetry.*): what this install reports, and the owner's answer on usage statistics. Asked once: in the
// setup on a fresh install, by a corner card on one that predates it. See rules/DECISIONS.md#d-092.
import type { TelemetryState } from "@apx/protocol";
import { t } from "../i18n/index.ts";
import { client } from "./client.ts";
import { createStore, useSlice } from "./createStore.ts";
import { notify } from "./notices.ts";

type State = { state: TelemetryState | undefined };
const store = createStore<State>({ state: undefined });

export const useTelemetry = <T>(select: (s: State) => T): T => useSlice(store, select);

/** The page linked from every place that asks: what is sent, and what is not. */
export const PRIVACY_URL = "https://agentprojectcontext.github.io/apx/v2/reference/privacy/";

/** Says the panel opened (the `opened` step, once) and reads where telemetry stands. */
export async function loadTelemetry(): Promise<void> {
  try {
    await client.call("telemetry.seen", {});
    store.set({ state: await client.call("telemetry.get", {}) });
  } catch {
    // An older core has no telemetry: nothing to ask.
  }
}

export async function refreshTelemetry(): Promise<void> {
  try {
    store.set({ state: await client.call("telemetry.get", {}) });
  } catch {}
}

export async function setUsage(usage: boolean): Promise<void> {
  try {
    store.set({ state: await client.call("telemetry.set", { usage }) });
  } catch (e) {
    notify(t("error.change", { error: e instanceof Error ? e.message : String(e) }));
  }
}
