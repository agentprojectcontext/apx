import type { ServiceInfo, ServiceSettings, ServiceTest } from "@apx/protocol";
import { client } from "../data/client.ts";
import type { T } from "../i18n/index.ts";

/** A saved service as the form and services.test take it. */
export function settingsOf(s: ServiceInfo): ServiceSettings {
  const { id: _i, key_set: _k, status: _s, ...settings } = s;
  return settings;
}

/** Asks the core to try a service now; a failed call reads as one that could not be reached. */
export async function testService(service: ServiceSettings, id?: string, apiKey?: string): Promise<ServiceTest> {
  try {
    return await client.call("services.test", {
      service,
      ...(id ? { id } : {}),
      ...(apiKey ? { api_key: apiKey } : {}),
    });
  } catch (e) {
    return { ok: false, problem: "other", detail: e instanceof Error ? e.message : String(e) };
  }
}

/** What a test found, as the owner reads it: it answers, or why it does not and what to look at. */
export function checkText(t: T, r: ServiceTest): string {
  if (r.ok) return r.models?.length ? t("svc.check.okModels", { count: r.models.length }) : t("svc.check.ok");
  return t(`svc.check.${r.problem ?? "other"}`, { detail: r.detail ?? "" });
}

/** The chosen model is not among the ones the server listed. */
export function missingModel(t: T, r: ServiceTest, s: ServiceSettings): string | undefined {
  const model = s.model?.trim();
  if (!r.ok || !r.models?.length || !model) return undefined;
  if (r.models.some((m) => m === model || m === `${model}:latest` || m.replace(/:latest$/, "") === model))
    return undefined;
  return t(s.dialect.startsWith("ollama") ? "svc.check.noModelOllama" : "svc.check.noModel", { model });
}
