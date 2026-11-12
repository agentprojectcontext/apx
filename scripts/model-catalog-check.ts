// The daily model catalog check (rules/MODEL_CATALOGS.md#daily-check): asks the running core for every engine's list,
// then prints JSON for the agent that reviews it: what appeared or left since the last run, agent and router choices a
// provider no longer lists, and pinned defaults gone from their provider's list.
//   node scripts/model-catalog-check.ts [--state .apc/model-catalog-last.json] [--no-refresh]
import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import { missingPinned, PINNED } from "../apps/core/src/models/pinned.ts";

type Model = { id: string; chat: boolean };
export type Engine = { id: string; kind: string; available: boolean; detail?: string; models: Model[] };
type Choice = { model?: string; fallbacks?: string[] } | null;
export type Snapshot = {
  engines: Engine[];
  config: { default: Choice; router: { chain: string[]; rules: Array<{ model: string }> } };
  agents: Array<{ agent: string; model_choice: Choice }>;
};

/** Providers whose whole list is compared run to run; the rest (hundreds on OpenRouter) only for choices. */
const WATCHED = new Set(["gemini", "groq", "anthropic", "openai", "chatgpt", "codex", "claude", "cerebras", "mistral"]);

/** "gemini/gemini-4-argon#high" → ["gemini", "gemini-4-argon"]; a bare engine has no model. */
function split(ref: string): [string, string] {
  const [engine = "", ...rest] = ref.split("#")[0]?.split("/") ?? [];
  return [engine, rest.join("/")];
}

export function review(now: Snapshot, last: Record<string, string[]>) {
  const listed = (e: Engine) => e.available && e.models.length > 0;
  const lists = Object.fromEntries(
    now.engines.filter((e) => WATCHED.has(e.id) && listed(e)).map((e) => [e.id, e.models.map((m) => m.id).sort()]),
  );
  const changes = Object.entries(lists).flatMap(([provider, ids]) => {
    const before = last[provider];
    if (!before) return [];
    const added = ids.filter((m) => !before.includes(m));
    const removed = before.filter((m) => !ids.includes(m));
    return added.length || removed.length ? [{ provider, added, removed }] : [];
  });
  const byId = new Map(now.engines.map((e) => [e.id, e]));
  const refs = (who: string, c: Choice) => [c?.model, ...(c?.fallbacks ?? [])].flatMap((r) => (r ? [{ who, r }] : []));
  const chosen = [
    ...refs("default", now.config.default),
    ...now.config.router.chain.map((r) => ({ who: "router chain", r })),
    ...now.config.router.rules.map((x) => ({ who: "router rule", r: x.model })),
    ...now.agents.flatMap((a) => refs(`agent ${a.agent}`, a.model_choice)),
  ];
  const gone = chosen.filter(({ r }) => {
    const [engine, model] = split(r);
    const e = byId.get(engine);
    // Only a list read today says a model left; a bare engine runs its own default.
    return e && listed(e) && model && !e.models.some((m) => m.id === model);
  });
  const ids = (id: string) => byId.get(id)?.models;
  const readable = Object.fromEntries(now.engines.filter(listed).map((e) => [e.id, ids(e.id)]));
  return {
    first_run: Object.keys(last).length === 0,
    not_refreshed: now.engines
      .filter((e) => WATCHED.has(e.id) && (e.detail || !e.available))
      .map((e) => `${e.id}: ${e.detail ?? "not available"}`),
    changes_since_last_run: changes,
    choices_no_longer_listed: gone.map(({ who, r }) => `${who}: ${r}`),
    pinned_missing: missingPinned(readable),
    pinned: Object.values(PINNED),
    lists,
  };
}

async function main() {
  const args = process.argv.slice(2);
  const repo = path.resolve(import.meta.dirname, "..");
  const at = args.indexOf("--state");
  const state = path.resolve(repo, at >= 0 ? (args[at + 1] ?? "") : ".apc/model-catalog-last.json");
  const cli = path.join(repo, "apps/terminal/src/main.ts");
  const { stdout } = await promisify(execFile)(
    process.execPath,
    [cli, "models", ...(args.includes("--no-refresh") ? [] : ["--refresh"]), "--json"],
    { cwd: repo, timeout: 300_000, maxBuffer: 32 * 1024 * 1024 },
  );
  const now = JSON.parse(stdout) as Snapshot;
  const last = fs.existsSync(state) ? (JSON.parse(fs.readFileSync(state, "utf8")) as Record<string, string[]>) : {};
  const out = review(now, last);
  fs.mkdirSync(path.dirname(state), { recursive: true });
  fs.writeFileSync(state, JSON.stringify(out.lists));
  console.log(JSON.stringify(out, null, 1));
}

if (import.meta.main) await main();
