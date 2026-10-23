// Profiles: what the super-agent is for, as data (an apx-profile.json). APX ships some; the owner installs more from a
// folder. The running one adds a block to the super-agent's system prompt and keeps its routines on the super-agent
// in step with its settings: created or adopted (from v1), rescheduled, on while it runs. They stay ordinary routines:
// the owner may edit their prompts (kept on later saves) and put the default back. See DECISIONS.md#d-037
import fs from "node:fs";
import path from "node:path";
import {
  type ActiveProfile,
  type Localized,
  type ProfileInfo,
  ProfileManifest,
  type ProfileRoutine,
  type Routine,
  type Schedule,
} from "@apx/protocol";
import type { Store } from "../domain/store.ts";

export const PROFILE_FILE = "apx-profile.json";

export type ProfileRoot = { dir: string; source: ProfileInfo["source"] };
type Values = ActiveProfile["values"];

const originOf = (profile: string, key: string) => `${profile}:${key}`;
export const textIn = (l: Localized, lang: string) => l[lang] ?? l.en;

/** A folder's manifest, or why it is not one. */
export function readProfile(dir: string): ProfileManifest {
  const raw = JSON.parse(fs.readFileSync(path.join(dir, PROFILE_FILE), "utf8")) as unknown;
  return ProfileManifest.parse(raw);
}

/** Every profile found: the owner's win over APX's own of the same id. */
export function listProfiles(roots: readonly ProfileRoot[]): ProfileInfo[] {
  const byId = new Map<string, ProfileInfo>();
  for (const root of roots) {
    let names: string[] = [];
    try {
      names = fs.readdirSync(root.dir);
    } catch {
      continue;
    }
    for (const name of names.sort())
      try {
        const m = readProfile(path.join(root.dir, name));
        byId.set(m.id, { ...m, source: root.source });
      } catch {}
  }
  return [...byId.values()];
}

export const activeProfile = (store: Store): ActiveProfile => store.settings.read("profile");

/**
 * The values a profile runs with: its defaults, then what the owner set (only for settings it declares). A number
 * keeps inside its setting's range: it ends up in a schedule, where 0 minutes or 61 would not run.
 */
export function valuesFor(m: ProfileManifest, values: Values): Values {
  return Object.fromEntries(
    m.settings.map((f) => {
      const v = values[f.key];
      if (f.type !== "number") return [f.key, typeof v === "string" ? v : f.default];
      if (typeof v !== "number" || !Number.isFinite(v)) return [f.key, f.default];
      return [f.key, Math.min(f.max ?? v, Math.max(f.min ?? v, v))];
    }),
  );
}

/** `{{key}}` in a text, from the values; a choice gives its option's prompt line. */
function fill(text: string, m: ProfileManifest, values: Values): string {
  return text.replace(/\{\{([a-z][a-z0-9_]*)\}\}/g, (_, key: string) => {
    const field = m.settings.find((f) => f.key === key);
    const v = values[key];
    if (field?.type === "choice") return field.options?.find((o) => o.value === v)?.prompt ?? "";
    return v === undefined ? "" : String(v);
  });
}

/** The block the super-agent's system prompt carries while a profile runs. */
export function profileBlock(store: Store, roots: readonly ProfileRoot[]): string {
  const active = activeProfile(store);
  if (!active.id) return "";
  const m = listProfiles(roots).find((p) => p.id === active.id);
  if (!m?.prompt) return "";
  return fill(m.prompt, m, valuesFor(m, active.values))
    .split("\n")
    .filter((l) => l.trim())
    .join("\n");
}

function scheduleOf(r: ProfileRoutine, m: ProfileManifest, values: Values): Schedule {
  if (r.schedule.kind === "cron") return { kind: "cron", cron: fill(r.schedule.cron, m, values).trim() };
  const hours = Number(typeof r.schedule.hours === "number" ? r.schedule.hours : fill(r.schedule.hours, m, values));
  return { kind: "every", minutes: Math.round(Math.max(1, Number.isFinite(hours) ? hours : 1) * 60) };
}

/** The routines a profile keeps (any profile's: they are found by origin). */
export const profileRoutines = (store: Store, id?: string | null): Routine[] =>
  store.routines
    .list()
    .filter((r) => (id ? r.origin?.startsWith(`${id}:`) : r.origin && /^[a-z0-9-]+:[a-z]/.test(r.origin)));

/** Every schedule the profile would set, so a bad cron is refused before anything changes. */
export function profileSchedules(m: ProfileManifest, values: Values): Schedule[] {
  const v = valuesFor(m, values);
  return m.routines.map((r) => scheduleOf(r, m, v));
}

/**
 * Runs a profile (or none): saves it and brings routines in step. The previous profile's routines are turned off
 * (kept, with any prompt the owner wrote); this one's are created or adopted on the super-agent, rescheduled and on.
 */
export function applyProfile(
  store: Store,
  o: {
    manifest: ProfileManifest | undefined;
    values: Values;
    lang: string;
    nextFor: (s: Schedule) => string | undefined;
  },
): ActiveProfile {
  const m = o.manifest;
  const active: ActiveProfile = m ? { id: m.id, values: valuesFor(m, o.values) } : { id: null, values: {} };
  store.settings.write("profile", active);
  for (const r of profileRoutines(store))
    if (r.enabled && (!m || !r.origin?.startsWith(`${m.id}:`)))
      store.routines.update(r.id, { ...r, next_run_at: undefined, enabled: false });
  const agent = store.agents.list().find((a) => a.kind === "secretary");
  if (!m || !agent) return active;
  const all = store.routines.list(null);
  for (const spec of m.routines) {
    const origin = originOf(m.id, spec.key);
    const mine =
      all.find((r) => r.origin === origin) ??
      all.find((r) => !r.origin && spec.v1.includes(r.name) && r.agent_id === agent.id);
    const schedule = scheduleOf(spec, m, active.values);
    const pre = spec.pre_command !== undefined ? fill(spec.pre_command, m, active.values).trim() : mine?.pre_command;
    const draft = {
      name: mine?.name ?? textIn(spec.name, o.lang),
      agent_id: agent.id,
      project_id: undefined,
      schedule,
      action: spec.action,
      // The owner's edits to a profile routine stay; a v1 routine it adopts gets v2's prompt (v1's names v1's tools).
      prompt: mine?.origin ? mine.prompt : fill(spec.prompt, m, active.values),
      pre_command: pre || undefined,
      post_command: mine?.post_command,
      call_model: mine?.call_model ?? ("always" as const),
      anchor: spec.anchor,
      max_steps: mine?.max_steps,
      origin,
      enabled: true,
      next_run_at: o.nextFor(schedule),
    };
    if (mine) store.routines.update(mine.id, draft);
    else store.routines.create(draft);
  }
  return active;
}

/** The prompt a profile routine ships with, its settings filled in as the profile runs now (stale days, hours). */
function shippedPrompt(store: Store, profiles: readonly ProfileManifest[], r: Routine): string | undefined {
  const [profile, key] = r.origin?.split(":") ?? [];
  const m = profiles.find((p) => p.id === profile);
  const spec = m?.routines.find((x) => x.key === key);
  return m && spec ? fill(spec.prompt, m, valuesFor(m, activeProfile(store).values)) : undefined;
}

/** The profile routines whose prompt is no longer the one shipped: the owner edited it, or a setting changed since. */
export function changedRoutines(store: Store, roots: readonly ProfileRoot[], routines: readonly Routine[]): string[] {
  const profiles = listProfiles(roots);
  return routines
    .filter((r) => {
      const shipped = shippedPrompt(store, profiles, r);
      return shipped !== undefined && shipped.trim() !== r.prompt.trim();
    })
    .map((r) => r.id);
}

/** A profile routine back to the prompt its profile ships. */
export function restoreProfileRoutine(store: Store, roots: readonly ProfileRoot[], id: string): Routine | undefined {
  const r = store.routines.get(id);
  const prompt = r && shippedPrompt(store, listProfiles(roots), r);
  if (!r || prompt === undefined) return undefined;
  return store.routines.update(id, { ...r, next_run_at: r.next_run_at, prompt });
}

/** Copies a profile folder into the owner's profiles (replacing one of the same id). */
export function installProfile(roots: readonly ProfileRoot[], from: string): ProfileInfo {
  const owner = roots.find((r) => r.source === "owner");
  if (!owner) throw new Error("no folder for installed profiles");
  const m = readProfile(from);
  const to = path.join(owner.dir, m.id);
  fs.rmSync(to, { recursive: true, force: true });
  fs.mkdirSync(owner.dir, { recursive: true });
  fs.cpSync(from, to, { recursive: true, dereference: false, filter: (src) => !path.basename(src).startsWith(".") });
  return { ...m, source: "owner" };
}

export function removeProfile(roots: readonly ProfileRoot[], id: string): boolean {
  const owner = roots.find((r) => r.source === "owner");
  if (!owner || !/^[a-z0-9][a-z0-9-]{0,40}$/.test(id)) return false;
  const dir = path.join(owner.dir, id);
  if (!fs.existsSync(path.join(dir, PROFILE_FILE))) return false;
  fs.rmSync(dir, { recursive: true, force: true });
  return true;
}
