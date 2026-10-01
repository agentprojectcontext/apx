// Model APIs the owner adds or changes from the app. Keys go to the secret store under the provider's name.
import type { ProviderInfo } from "@apx/protocol";
import { NO_KEY } from "../providers/llm.ts";
import type { ProviderRegistry } from "../providers/registry.ts";
import type { Secrets } from "../secrets.ts";
import type { Handler } from "./router.ts";

export function providerHandlers(providers: ProviderRegistry, secrets: Secrets) {
  const list = (): ProviderInfo[] =>
    providers.all().map((p) => ({
      id: p.id,
      label: p.label || p.id,
      ...(p.preset ? { preset: p.preset } : {}),
      transport: p.transport,
      base_url: p.base_url,
      key_set: p.key === NO_KEY || secrets.has(p.key),
      needs_key: p.key !== NO_KEY,
      models: p.models,
      enabled: p.enabled !== false,
      builtin: p.builtin,
    }));
  return {
    "providers.list": (() => ({ providers: list() })) as Handler<"providers.list">,
    "providers.set": (({ id, provider, api_key }) => {
      if (api_key) secrets.set(id, api_key);
      if (!provider) {
        providers.set(id, null);
        return { providers: list() };
      }
      const current = providers.all().find((p) => p.id === id);
      providers.set(id, {
        transport: provider.transport,
        base_url: provider.base_url.replace(/\/$/, ""),
        // An existing reference is kept (a built-in may point at an env var); a new provider gets its own secret.
        key: provider.needs_key === false ? NO_KEY : current && current.key !== NO_KEY ? current.key : `secret://${id}`,
        models: provider.models ?? current?.models ?? [],
        label: provider.label,
        preset: provider.preset,
        enabled: provider.enabled ?? true,
      });
      return { providers: list() };
    }) as Handler<"providers.set">,
  };
}
