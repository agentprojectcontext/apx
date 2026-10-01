// Which engines can run an agent's turn on this machine: installed → logged in → default.
// Login is asked to each CLI itself; APX never reads, copies or refreshes their tokens.
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { EngineStatus, HarnessId } from "@apx/protocol";
import type { Store } from "../domain/store.ts";
import { type LlmConfig, resolveKey } from "./provider.ts";

const run = promisify(execFile);
const CACHE_MS = 60_000;

async function cli(cmd: string, args: string[]): Promise<string | undefined> {
  try {
    // Some CLIs (codex login status) answer on stderr.
    const { stdout, stderr } = await run(cmd, args, { timeout: 15_000, maxBuffer: 1024 * 1024 });
    return stdout.trim() || stderr.trim() || undefined;
  } catch {
    return undefined;
  }
}

/** Absolute path of a binary on PATH (the user's own install), or undefined. */
export async function which(bin: string): Promise<string | undefined> {
  const out = await cli("/usr/bin/which", [bin]);
  return out?.split("\n")[0] || undefined;
}

async function detect(llm: LlmConfig): Promise<Omit<EngineStatus, "default">[]> {
  const [claudePath, codexPath] = await Promise.all([which("claude"), which("codex")]);
  const [claudeVersion, claudeAuth, codexVersion, codexLogin] = await Promise.all([
    claudePath ? cli(claudePath, ["--version"]) : undefined,
    claudePath ? cli(claudePath, ["auth", "status", "--json"]) : undefined,
    codexPath ? cli(codexPath, ["--version"]) : undefined,
    codexPath ? cli(codexPath, ["login", "status"]) : undefined,
  ]);
  let claudeLogged = false;
  let claudeDetail: string | undefined;
  try {
    const a = JSON.parse(claudeAuth ?? "{}") as { loggedIn?: boolean; authMethod?: string; subscriptionType?: string };
    claudeLogged = Boolean(a.loggedIn);
    claudeDetail = [a.authMethod, a.subscriptionType].filter(Boolean).join(" · ") || undefined;
  } catch {}
  return [
    {
      id: "native",
      label: "APX (modelo propio)",
      installed: true,
      logged_in: Boolean(resolveKey(llm.keyRef)),
      detail: llm.models[0],
    },
    {
      id: "claude",
      label: "Claude Code",
      installed: Boolean(claudePath),
      logged_in: claudeLogged,
      ...(claudeVersion ? { version: claudeVersion.split(" ")[0] } : {}),
      ...(claudeDetail ? { detail: claudeDetail } : {}),
    },
    {
      id: "codex",
      label: "Codex",
      installed: Boolean(codexPath),
      logged_in: /logged in/i.test(codexLogin ?? ""),
      ...(codexVersion ? { version: codexVersion.replace(/^codex-cli\s*/, "") } : {}),
      ...(codexLogin ? { detail: codexLogin.replace(/^Logged in using\s*/i, "") } : {}),
    },
  ];
}

export function createEngines(store: Store, llm: LlmConfig) {
  let cache: { at: number; list: Omit<EngineStatus, "default">[] } | undefined;
  const defaultId = (): HarnessId => (store.setting("default_harness") as HarnessId | undefined) ?? "native";
  return {
    defaultId,
    async status(refresh = false): Promise<EngineStatus[]> {
      if (refresh || !cache || Date.now() - cache.at > CACHE_MS) cache = { at: Date.now(), list: await detect(llm) };
      const d = defaultId();
      return cache.list.map((e) => ({ ...e, default: e.id === d }));
    },
    setDefault(id: HarnessId): void {
      store.setSetting("default_harness", id);
    },
  };
}

export type Engines = ReturnType<typeof createEngines>;
