// Model APIs the owner adds or changes from the app. Keys go to the secret store under the provider's name.
import fs from "node:fs";
import path from "node:path";
import type { ChatgptStatus, Params, ProviderInfo } from "@apx/protocol";
import { OAUTH_CHATGPT } from "../config.ts";
import { badRequest } from "../errors.ts";
import type { ChatgptLogin } from "../providers/chatgpt-login.ts";
import { NO_KEY } from "../providers/llm.ts";
import { createOpenRouterLogin, type OpenRouterLogin } from "../providers/openrouter-login.ts";
import type { ProviderRegistry } from "../providers/registry.ts";
import type { Secrets } from "../secrets.ts";
import type { Handlers } from "./router.ts";

export function providerHandlers(
  providers: ProviderRegistry,
  secrets: Secrets,
  chatgpt: { login: ChatgptLogin; v1Home: string },
  openrouter: OpenRouterLogin = createOpenRouterLogin(),
) {
  /** APX v1's own ChatGPT sign-in file (only read). */
  const v1File = path.join(chatgpt.v1Home, "auth", "chatgpt-codex.json");
  const status = (): ChatgptStatus => ({ ...chatgpt.login.status(), v1_available: fs.existsSync(v1File) });
  const signedIn = (key: string) =>
    key === OAUTH_CHATGPT ? { sign_in: "chatgpt", key_set: chatgpt.login.has() } : undefined;
  const keyHint = (ref: string): string | undefined => {
    if (ref === NO_KEY || ref === OAUTH_CHATGPT) return undefined;
    const value = secrets.resolve(ref);
    return value && value.length >= 12 ? value.slice(-4) : undefined;
  };
  const list = (): ProviderInfo[] =>
    providers.all().map((p) => ({
      id: p.id,
      label: p.label || p.id,
      ...(p.preset ? { preset: p.preset } : {}),
      transport: p.transport,
      base_url: p.base_url,
      key_set: p.key === NO_KEY || secrets.has(p.key),
      key_hint: keyHint(p.key),
      needs_key: p.key !== NO_KEY,
      models: p.models,
      enabled: p.enabled !== false,
      builtin: p.builtin,
      ...(p.local ? { local: true } : {}),
      ...signedIn(p.key),
    }));
  return {
    "chatgpt.status": () => status(),
    "chatgpt.connect": async ({ via }) => {
      if (via === "v1") {
        if (!chatgpt.login.importV1(v1File)) throw badRequest("APX v1 has no ChatGPT sign-in to take over");
      } else await chatgpt.login.start();
      return status();
    },
    "chatgpt.disconnect": () => {
      chatgpt.login.disconnect();
      return status();
    },
    "openrouter.connect": ({ callback }) => {
      try {
        return openrouter.start(callback);
      } catch (e) {
        throw badRequest(e instanceof Error ? e.message : String(e));
      }
    },
    "openrouter.finish": async ({ code, state }) => {
      let key: string;
      try {
        key = await openrouter.finish(code, state);
      } catch (e) {
        throw badRequest(e instanceof Error ? e.message : String(e));
      }
      save("openrouter", OPENROUTER_PROVIDER, key);
      return { ok: true as const };
    },
    "providers.list": () => ({ providers: list() }),
    "providers.set": ({ id, provider, api_key }) => {
      if (provider && ["claude", "codex", "native", "acp", "aider", "antigravity"].includes(id)) {
        throw badRequest(`Provider id ${id} is reserved for a harness`);
      }
      if (!provider) {
        providers.set(id, null);
        return { providers: list() };
      }
      save(id, provider, api_key);
      return { providers: list() };
    },
  } satisfies Partial<Handlers>;

  function save(id: string, provider: Params<"providers.set">["provider"] & object, api_key: string | undefined) {
    if (api_key) secrets.set(id, api_key);
    const current = providers.all().find((p) => p.id === id);
    providers.set(id, {
      transport: provider.transport,
      base_url: provider.base_url.replace(/\/$/, ""),
      // An existing reference is kept (a built-in may point at an env var); a new provider gets its own secret.
      key:
        provider.needs_key === false
          ? NO_KEY
          : api_key
            ? `secret://${id}`
            : current && current.key !== NO_KEY
              ? current.key
              : `secret://${id}`,
      models: provider.models ?? current?.models ?? [],
      label: provider.label,
      preset: provider.preset,
      enabled: provider.enabled ?? true,
    });
  }
}

/** OpenRouter as its sign-in adds it: the same as its preset in the panel. */
const OPENROUTER_PROVIDER = {
  label: "OpenRouter",
  preset: "openrouter",
  transport: "openai-chat",
  base_url: "https://openrouter.ai/api/v1",
  needs_key: true,
} as const;
