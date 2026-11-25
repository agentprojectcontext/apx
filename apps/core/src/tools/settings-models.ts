// apx_settings, which models run and how APX talks and listens: the router, a chat's model, APX's voice, local
// transcription, and the tools of an MCP server already added. Opened to the super-agent at the owner's word
// (DECISIONS.md#d-268, over D-060); each change is checked against the connected engines before it is written.
import type { ModelChoice, RouterConfig } from "@apx/protocol";
import { modelSettings } from "../models/choice.ts";
import { LOCAL_MODELS, machine, recommend } from "../services/local-whisper.ts";
import { type Params, quoted, type Setting, type SettingsDeps, str } from "./settings-kit.ts";
import type { ToolContext } from "./types.ts";

type Call = NonNullable<ToolContext["callAsOwner"]>;

/** The engine of a model ref ("gemini/…" → gemini; "acp:x/…" → acp:x). */
const engineOf = (ref: string) => ref.replace(/#.*$/, "").split("/")[0] ?? "";

/**
 * Why these models cannot run now, or undefined: a provider that is off or has no key would leave every turn on it
 * failing. The method itself still checks each ref's shape and engine (models/choice.ts refProblem); an ACP agent is
 * its own to check.
 */
async function unreachable(refs: readonly (string | null | undefined)[], call: Call): Promise<string | undefined> {
  const wanted = [...new Set(refs.filter((r): r is string => !!r).map(engineOf))].filter((e) => !e.startsWith("acp:"));
  if (!wanted.length) return undefined;
  const { providers } = await call("providers.list", {});
  const off = wanted.filter((id) => {
    const p = providers.find((x) => x.id === id);
    return p && (!p.enabled || !p.key_set);
  });
  return off.length
    ? `not saved: ${off.join(", ")} ${off.length === 1 ? "is" : "are"} off or without a key here (Settings › Engines and models); nothing changed`
    : undefined;
}

const refsOf = (p: Params): string[] => {
  const d = p.default as ModelChoice | undefined;
  const r = p.router as RouterConfig | undefined;
  return [d?.model, ...(d?.fallbacks ?? []), ...(r?.chain ?? []), ...(r?.rules ?? []).map((x) => x.model)].filter(
    (x): x is string => !!x,
  );
};

const config = ({ store }: SettingsDeps) => {
  const m = modelSettings(store);
  return { default: m.defaultChoice(), router: m.router() };
};

const choiceWords = (v: unknown) => {
  const c = v as ModelChoice | null | undefined;
  if (!c) return "back to the agent's own model";
  return c.model ? `${c.model}${c.router ? ", the router after it" : ""}` : "the router";
};

export const MODELS: Readonly<Record<string, Setting>> = {
  "models.config": {
    does: "the install's default model and the router: its rules and the chain it falls back on",
    read: (_p, d) => JSON.stringify(config(d)),
  },
  "models.set_config": {
    does: "change the default model (default: model, router) or the router (router: rules, chain; only what changes); engines must be connected (models.list)",
    says: (p) =>
      p.default && p.router
        ? "Change the default model and the router"
        : p.default
          ? "Change the default model"
          : "Change the router",
    now: (_p, d) => config(d),
    keep: (p, d) => {
      const cur = config(d);
      const r = p.router as Partial<RouterConfig> | undefined;
      return {
        ...(p.default ? { default: p.default } : {}),
        ...(r ? { router: { rules: r.rules ?? cur.router.rules, chain: r.chain ?? cur.router.chain } } : {}),
      };
    },
    refuse: (p) => {
      const r = p.router as Partial<RouterConfig> | undefined;
      if (!p.default && !r) return "give default or router";
      return r?.chain && !r.chain.length ? "the router's chain needs at least one model to fall back on" : undefined;
    },
    owner: async (p, _d, call) => {
      const off = await unreachable(refsOf(p), call);
      if (off) return off;
      const r = await call("models.set_config", p as never);
      return `saved: default ${choiceWords(r.default)}; router chain ${r.router.chain.join(" → ")}`;
    },
  },
  "threads.model": {
    does: "the model one chat runs on (thread, model_choice: model, router; null: back to its agent's)",
    named: ["thread"],
    says: (p, { store }) =>
      `Change the model of the chat ${quoted(store.threads.get(str(p.thread))?.title ?? str(p.thread), 80)}`,
    words: { model_choice: (v) => `model: ${choiceWords(v)}` },
    now: (p, { store }) =>
      store.threads.get(str(p.thread))
        ? { thread: p.thread, model_choice: store.threads.context(str(p.thread)).model_choice ?? null }
        : undefined,
    owner: async (p, _d, call) => {
      const c = p.model_choice as ModelChoice | null;
      const off = await unreachable([c?.model, ...(c?.fallbacks ?? [])], call);
      if (off) return off;
      await call("threads.model", p as never);
      return `saved: the chat runs on ${choiceWords(c)}`;
    },
  },
  "voice.status": {
    does: "APX's own voice and calls as saved: on or off, the voice, calls, quality, the call's model and services",
    read: (_p, { store }) => JSON.stringify(store.settings.read("voice")),
  },
  "voice.set": {
    does: "change APX's voice and calls (only what changes: enabled, voice, calls, quality, call_model, call_engine, call_speech, call_transcription); turning it on downloads APX's voice here",
    says: () => "Change APX's voice and calls",
    now: (_p, { store }) => store.settings.read("voice") as Params,
    refuse: (p, { store }) => {
      const ids = new Set(store.settings.read("services").map((s) => s.id));
      const missing = [p.call_speech, p.call_transcription].filter((x) => typeof x === "string" && !ids.has(x));
      return missing.length ? `no service ${missing.join(", ")} (services.list)` : undefined;
    },
    owner: async (p, _d, call) => {
      const off = await unreachable([p.call_model as string | null | undefined], call);
      if (off) return off;
      const s = await call("voice.set", p as never);
      return `saved: voice ${s.enabled ? "on" : "off"}, calls ${s.calls ? "on" : "off"}${s.call_model ? `, calls run on ${s.call_model}` : ""}`;
    },
  },
  "transcription.local": {
    does: "local transcription on this computer: the whisper.cpp models, the one that fits, and the transcription services",
    read: (_p, { store }) =>
      [
        `models: ${LOCAL_MODELS.map((m) => `${m.id} (${m.mb} MB, ${m.quality})`).join(", ")}`,
        `fits this computer: ${recommend(machine())}`,
        `transcription services, tried in order: ${
          store.settings
            .read("services")
            .filter((s) => s.kind === "transcription")
            .map((s) => `${s.id} (${s.enabled ? "on" : "off"})`)
            .join(", ") || "none"
        }`,
      ].join("\n"),
  },
  "transcription.install": {
    does: "download a whisper.cpp model (from transcription.local) and make it the first transcription service; whisper.cpp itself is the owner's to install",
    named: ["model"],
    says: (p) => `Transcribe on this computer with ${str(p.model)}`,
    refuse: (p) =>
      LOCAL_MODELS.some((m) => m.id === str(p.model))
        ? undefined
        : `pick one of ${LOCAL_MODELS.map((m) => m.id).join(", ")}`,
    shows: (r) => {
      const s = r as { download?: { model?: string; error?: string }; active?: string; install_hint?: string };
      if (s.download?.error) return `the download failed (${s.download.error}); transcription keeps its service`;
      if (s.install_hint) return `the model downloads, but whisper.cpp is missing here: ${s.install_hint}`;
      if (s.download) return "downloading; transcription switches to it once it is here";
      return `transcription runs on ${s.active ?? "the model"} now`;
    },
  },
  "mcp.approveTool": {
    does: "let agents run one tool of an MCP server already added without asking each time (scope global or project, server, project, tool)",
    named: ["scope", "server", "project", "tool"],
    says: (p) => `Let agents run ${str(p.tool)} of the MCP server ${str(p.server)} without asking`,
  },
  "mcp.toolMode": {
    does: "whether agents ask before each tool of an MCP server already added and approved (scope, server, project, mode: ask or all)",
    named: ["scope", "server", "project", "mode"],
    says: (p) =>
      p.mode === "all"
        ? `Let agents run every tool of the MCP server ${str(p.server)} without asking`
        : `Make agents ask before each tool of the MCP server ${str(p.server)}`,
  },
  "mcp.trust": {
    does: "approve a project's MCP server from its .agent/mcps.json so it runs (project, server, trusted), or stop it (trusted false)",
    named: ["project", "server", "trusted"],
    says: (p) =>
      p.trusted
        ? `Run the MCP server ${str(p.server)} from the project's file`
        : `Stop the MCP server ${str(p.server)}`,
    // Running a new command on this computer is adding a server: the owner's card (DECISIONS.md#d-267).
    asks: (p) => (p.trusted ? "card" : undefined),
  },
};
