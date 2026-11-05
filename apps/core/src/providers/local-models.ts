// Model apps running on this computer (Ollama, LM Studio): their chat models are offered as a provider with no setup.
// Only loopback is asked, with a short timeout: when the catalog is listed, and by a background check (D-171) that
// tells the panel when one opens or closes. An app found once stays offered while closed, shown as unavailable.
import type { LocalApp, ProviderConfig } from "../config.ts";
import type { Store } from "../domain/store.ts";
import type { BackgroundCheck } from "../engine/background.ts";
import { NO_KEY } from "./llm.ts";

const HOST = "127.0.0.1";
const LOOPBACK = new Set(["127.0.0.1", "localhost", "[::1]"]);
const LOCAL_TIMEOUT_MS = 1500;
const CHECK_EVERY_MS = 10 * 60_000;

/** The `host:port` of a loopback address, so "localhost:11434" and "127.0.0.1:11434" are one server; else none. */
export function loopbackServer(url: string): string | undefined {
  try {
    const u = new URL(url);
    if (!LOOPBACK.has(u.hostname)) return undefined;
    return `loopback:${u.port || (u.protocol === "https:" ? "443" : "80")}`;
  } catch {
    return undefined;
  }
}

/** The models an OpenAI-compatible server on this computer lists; throws when it does not answer in time. */
export async function localModelIds(base: string, fetchImpl: typeof fetch = fetch): Promise<string[]> {
  if (!loopbackServer(base)) throw new Error("not on this computer");
  const res = await fetchImpl(`${base.replace(/\/$/, "")}/models`, { signal: AbortSignal.timeout(LOCAL_TIMEOUT_MS) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const body = (await res.json()) as { data?: Array<{ id?: unknown }> };
  return (body.data ?? []).flatMap((m) => (typeof m.id === "string" ? [m.id] : []));
}

export function createLocalModels(deps: {
  store: Store;
  apps: LocalApp[];
  fetchImpl?: typeof fetch;
  /** An app opened, closed or was found for the first time. */
  onChange?: () => void;
}) {
  const { store, apps } = deps;
  const running = new Map<string, boolean>();
  const base = (app: LocalApp) => `http://${HOST}:${app.port}/v1`;
  const seen = () => new Set(store.settings.read("local_models_seen"));

  /** Asks one app; remembers it as found when it answers. True when something changed. */
  async function look(app: LocalApp): Promise<boolean> {
    const up = await localModelIds(base(app), deps.fetchImpl).then(
      () => true,
      () => false,
    );
    const was = running.get(app.id);
    running.set(app.id, up);
    const known = seen();
    if (up && !known.has(app.id)) {
      store.settings.write("local_models_seen", [...known, app.id]);
      return true;
    }
    return was !== undefined && was !== up;
  }

  const check: BackgroundCheck = {
    id: "local-models",
    everyMs: CHECK_EVERY_MS,
    run: async () => {
      const changed = await Promise.all(apps.map(look));
      if (changed.some(Boolean)) deps.onChange?.();
    },
  };

  return {
    /** The apps found so far, as providers; a closed one stays (its models are then unavailable). */
    providers(): ProviderConfig[] {
      const known = seen();
      return apps
        .filter((a) => known.has(a.id))
        .map((a) => ({
          id: a.id,
          label: a.label,
          transport: "openai-chat",
          base_url: base(a),
          key: NO_KEY,
          models: [],
          local: true,
        }));
    },
    /** Whether a provider's address is one of these apps' (an Ollama the owner set up by hand, too). */
    serves: (url: string) => apps.some((a) => loopbackServer(url) === loopbackServer(base(a))),
    /** Looks for the apps not found yet, before the catalog is listed; the found ones are asked by the catalog. */
    async discover(): Promise<void> {
      const known = seen();
      const changed = await Promise.all(apps.filter((a) => !known.has(a.id)).map(look));
      if (changed.some(Boolean)) deps.onChange?.();
    },
    check,
  };
}
