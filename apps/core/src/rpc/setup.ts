// The first-run setup: whether it is done, whether this install is new, and what APX v1 left on this machine.
import { execFile } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { greetOwner } from "../domain/greeting.ts";
import { errorMessage } from "../errors.ts";
import { jsonFile, v1Projects } from "../import/v1-data.ts";
import { importV1, scanV1, type V1ImportDeps } from "../import/v1-setup.ts";
import type { Handlers } from "./router.ts";

const DONE_KEY = "setup_done";
/** The global npm package v1's `apx` comes from. */
const V1_PACKAGE = "@agentprojectcontext/apx";
const run = promisify(execFile);
/** This checkout's command (apps/terminal): where `pnpm link --global` makes `apx` this APX. */
const TERMINAL = path.resolve(import.meta.dirname, "../../../terminal");

const readJson = (file: string): Record<string, unknown> | undefined => {
  try {
    const v = jsonFile(file);
    return v && typeof v === "object" ? (v as Record<string, unknown>) : undefined;
  } catch {
    return undefined;
  }
};
const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : undefined);

/** APX v1 on this machine: its folder has a config.json. Only names and counts come back, never its settings. */
export function findV1(home: string) {
  const config = readJson(path.join(home, "config.json"));
  if (!config) return null;
  const version = str(readJson(path.join(home, "update-check.json"))?.current);
  const identity = readJson(path.join(home, "identity.json"));
  const agent = str(identity?.agent_name);
  const sa = config.super_agent;
  const icon = sa && typeof sa === "object" ? str((sa as Record<string, unknown>).icon) : undefined;
  const blob = icon && /^[a-z]{2,20}$/.test(icon) ? icon : undefined;
  const owner = str(identity?.owner_name);
  const user = os.homedir();
  return {
    // Shown to the owner as they know it: ~/.apx.
    home: home.startsWith(user) ? `~${home.slice(user.length)}` : home,
    projects: v1Projects(home).length,
    ...(version ? { version } : {}),
    ...(agent ? { agent_name: agent } : {}),
    ...(blob ? { agent_blob: blob } : {}),
    ...(owner ? { owner_name: owner } : {}),
  };
}

export function setupHandlers(deps: V1ImportDeps) {
  const { store, v1Home } = deps;
  return {
    "setup.v1_scan": () => ({ groups: scanV1(v1Home) }),
    "setup.import_v1": ({ groups }) => importV1(deps, groups),
    "setup.status": () => ({
      done: store.settings.get(DONE_KEY) === "1",
      // Anything the owner already said means this install is in use: the setup does not open on its own then.
      fresh: !store.messages.anyFromOwner(),
      v1: findV1(v1Home),
      ...(fs.existsSync(TERMINAL) ? { terminal: TERMINAL } : {}),
    }),
    "setup.take_over_cli": async () => {
      if (!fs.existsSync(TERMINAL)) return { ok: false, detail: "this APX has no terminal to link" };
      // v1's package may already be gone: only the link has to work.
      await run("pnpm", ["remove", "-g", V1_PACKAGE]).catch(() => undefined);
      try {
        await run("pnpm", ["--dir", TERMINAL, "link", "--global"]);
        return { ok: true, detail: "apx now runs this APX" };
      } catch (err) {
        return { ok: false, detail: errorMessage(err, 300) };
      }
    },
    "setup.greet": ({ language }) => greetOwner(store, language),
    "setup.finish": () => {
      store.settings.set(DONE_KEY, "1");
      return { done: true as const };
    },
  } satisfies Partial<Handlers>;
}
