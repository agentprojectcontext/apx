// Moving from Hermes: a plan of what its home folder becomes in APX, each step with how to take it, so the import does
// exactly what the preview listed. What was taken is remembered by what it was, so importing again changes nothing
// and a thing changed in Hermes since is updated. Everything goes through APX's own methods, with the owner's checks.
import { createHash } from "node:crypto";
import path from "node:path";
import type { HermesItem, Schedule } from "@apx/protocol";
import { looksSecret } from "../domain/memories.ts";
import type { Store } from "../domain/store.ts";
import { expandHome } from "../paths.ts";
import type { InternalCall } from "../rpc/internal.ts";
import { serverName } from "./apply-extras.ts";
import { type HermesJob, type HermesProfile, type HermesServer, readHermes, skillsIn } from "./hermes-read.ts";
import { type ServerSecret, serverSecrets } from "./server-secrets.ts";

type Step = HermesItem & { apply?: () => Promise<void> };
type Record_ = { hash: string; ref?: string };

const OWNER = { actor: "human" } as const;
const NOTE_CHARS = 2000;
const hash = (v: unknown) => createHash("sha256").update(JSON.stringify(v)).digest("hex").slice(0, 16);
const slugOf = (name: string) =>
  name
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^[^a-z]+|-+$/g, "")
    .slice(0, 50);

const agentSlug = (p: HermesProfile) => (p.name === "default" ? "hermes" : `hermes-${slugOf(p.name) || "profile"}`);

function recordsOf(store: Store) {
  const key = (k: string) => `hermes_import:${k}`;
  return {
    get: (k: string) => JSON.parse(store.settings.get(key(k)) ?? "null") as Record_ | null,
    set: (k: string, r: Record_) => store.settings.set(key(k), JSON.stringify(r)),
  };
}

/** A Hermes cron schedule as APX's, or why it cannot be one. */
function scheduleOf(j: HermesJob): Schedule | "invalid" | "none" {
  const s = j.schedule;
  if (s.kind === "cron" && s.expr) return { kind: "cron", cron: s.expr };
  if (s.kind === "interval" && s.minutes) return s.minutes >= 5 ? { kind: "every", minutes: s.minutes } : "invalid";
  if (s.kind === "once" && s.run_at) return Date.parse(s.run_at) > Date.now() ? { kind: "once", at: s.run_at } : "none";
  return "invalid";
}

/** The folder a Hermes home is named by, as the owner or an agent wrote it. */
export const hermesHome = (folder: string) => path.resolve(expandHome(folder));

/**
 * A server with each credential in env or headers replaced by an empty secret:// reference, and the names of those
 * references. `stuck`: credentials in its arguments or address, where APX never keeps one (the process list shows
 * arguments, and an address is not resolved), so the server is not brought.
 */
function withoutSecrets(h: HermesServer): { server: HermesServer["server"]; secrets: string[]; stuck: ServerSecret[] } {
  const found = serverSecrets(h.server);
  const secrets: string[] = [];
  const swap = (values: Record<string, string> | undefined, at: ServerSecret["at"], name: (k: string) => string) =>
    values &&
    Object.fromEntries(
      Object.entries(values).map(([k, v]) => {
        if (!found.some((x) => x.at === at && x.key === k)) return [k, v];
        const ref = name(k);
        secrets.push(ref);
        return [k, `secret://${ref}`];
      }),
    );
  const env = swap(h.server.env, "env", (k) => k.replace(/[^A-Za-z0-9_.-]/g, "_").slice(0, 64));
  const headers = swap(h.server.headers, "header", (k) =>
    `${h.name}_${k}`
      .replace(/[^A-Za-z0-9_.-]/g, "_")
      .toUpperCase()
      .slice(0, 64),
  );
  const server = { ...h.server, ...(env ? { env } : {}), ...(headers ? { headers } : {}) };
  return { server, secrets, stuck: found.filter((x) => x.at === "arg" || x.at === "url") };
}

/** Where a server's stuck credentials are, and what the owner does instead. */
function stuckDetail(stuck: ServerSecret[]): string {
  const args = stuck.filter((x) => x.at === "arg").map((x) => x.key);
  return [
    args.length ? `in its arguments (${args.join(", ")}): add it yourself, the key in env` : "",
    stuck.some((x) => x.at === "url") ? "in its address: add it yourself, the key in a header" : "",
  ]
    .filter(Boolean)
    .join("; ");
}

const oneLine = (s: string) => s.replace(/\s+/g, " ").trim();
const runs = (s: HermesServer["server"]) =>
  oneLine(s.url ? `the server at ${s.url}` : `the command ${[s.command ?? "", ...(s.args ?? [])].join(" ")}`);

/**
 * What importing `home` brings, for the card an agent's import waits on: every MCP server whole, with what it runs
 * and whether it comes on, then the rest by name or count. Undefined when the folder is not a Hermes home.
 */
export function hermesCard(home: string): string | undefined {
  const profiles = readHermes(home);
  if (!profiles) return undefined;
  const agents = profiles.map((p) => oneLine(p.name === "default" ? "Hermes" : `Hermes ${p.name}`));
  const notes = profiles
    .flatMap((p) => [...p.memory, ...p.user])
    .filter((t) => !looksSecret(t.slice(0, NOTE_CHARS))).length;
  const skills = [...new Set(profiles.flatMap((p) => (p.skills ? skillsIn(p.skills) : [])))].map(oneLine);
  const routines = profiles
    .flatMap((p) => p.jobs)
    .filter((j) => !j.script && j.prompt && typeof scheduleOf(j) !== "string").length;
  const servers = profiles.flatMap((p) =>
    p.servers.flatMap((h) => {
      const { server, secrets, stuck } = withoutSecrets(h);
      if (stuck.length) return [];
      const name = serverName(h.name);
      const how = secrets.length ? `off until you save ${secrets.join(", ")}` : "turned on";
      return [`- MCP server ${name}, ${how}: runs ${runs(server)}`];
    }),
  );
  return [
    `Bring the Hermes setup in ${oneLine(home)} into APX:`,
    `- Agents, their SOUL.md as instructions: ${agents.join(", ")}`,
    notes ? `- ${notes} notes for their memory` : "",
    skills.length
      ? `- Skills for every agent: ${skills.slice(0, 30).join(", ")}${skills.length > 30 ? ` and ${skills.length - 30} more` : ""}`
      : "",
    routines ? `- ${routines} routines, turned off` : "",
    ...servers,
  ]
    .filter(Boolean)
    .join("\n");
}

/** Every step importing `home` takes, in order (an agent before what is its). Undefined if it is not a Hermes home. */
export async function hermesPlan(store: Store, call: InternalCall, home: string): Promise<Step[] | undefined> {
  const profiles = readHermes(home);
  if (!profiles) return undefined;
  const records = recordsOf(store);
  const steps: Step[] = [];
  const servers = new Set((await call("mcp.list", {}, OWNER)).servers.map((s) => s.name));
  const routines = (await call("routines.list", {}, OWNER)).routines;
  const seen = new Set<string>();

  for (const p of profiles) {
    const item = (kind: HermesItem["kind"], name: string): Pick<HermesItem, "kind" | "profile" | "name"> => ({
      kind,
      profile: p.name,
      name,
    });
    const slug = agentSlug(p);
    const agentKey = `agent:${slug}`;
    const known = store.agents.get(slug);
    const made = records.get(agentKey);
    // Instructions go into every prompt: a SOUL.md holding a credential is left out, never copied.
    const secretSoul = looksSecret(p.soul);
    const prompt = secretSoul ? "" : p.soul.slice(0, 100_000);
    const soulSkipped = { why: "secret" as const, detail: "SOUL.md: its instructions are left out" };
    const mine = !known || made !== null;
    if (known && !made) steps.push({ ...item("agent", slug), action: "skip", why: "taken" });
    else if (known && secretSoul) steps.push({ ...item("agent", slug), action: "skip", ...soulSkipped });
    else if (known && made?.hash === hash(prompt)) steps.push({ ...item("agent", slug), action: "skip", why: "same" });
    else
      steps.push({
        ...item("agent", slug),
        action: known ? "update" : "add",
        ...(secretSoul ? soulSkipped : {}),
        apply: async () => {
          if (known) await call("agents.update", { agent: slug, prompt }, OWNER);
          else
            await call(
              "agents.create",
              {
                slug,
                name: p.name === "default" ? "Hermes" : `Hermes ${p.name}`,
                description: `Brought from Hermes (profile ${p.name}).`,
                prompt,
              },
              OWNER,
            );
          records.set(agentKey, { hash: hash(prompt) });
        },
      });
    for (const name of p.personalities)
      steps.push({ ...item("setting", `personality ${name}`), action: "skip", why: "none" });

    const notes = [
      ...p.memory.map((text) => ({ text, scope: "agent" as const })),
      ...p.user.map((text) => ({ text, scope: "global" as const })),
    ];
    for (const n of notes) {
      const text = n.text.slice(0, NOTE_CHARS);
      const key = `note:${hash([n.scope, n.scope === "agent" ? slug : "", text])}`;
      const name = text.split("\n")[0]?.slice(0, 80) ?? "";
      if (looksSecret(text)) steps.push({ ...item("note", name), action: "skip", why: "secret" });
      else if (n.scope === "agent" && !mine)
        steps.push({ ...item("note", name), action: "skip", why: "taken", detail: slug });
      else if (records.get(key) || seen.has(key)) steps.push({ ...item("note", name), action: "skip", why: "same" });
      else
        steps.push({
          ...item("note", name),
          action: "add",
          apply: async () => {
            await call("memory.add", { text, scope: n.scope, ...(n.scope === "agent" ? { agent: slug } : {}) }, OWNER);
            records.set(key, { hash: hash(text) });
          },
        });
      seen.add(key);
    }

    if (p.skills) {
      const source = { kind: "folder" as const, path: p.skills };
      const { candidates } = await call("skills.preview", { source, target: "global" }, OWNER);
      for (const c of candidates) {
        const scripts = c.notes.find((x) => x.kind === "scripts");
        const detail = scripts ? { detail: `scripts: ${scripts.items.join(", ")}` } : {};
        if (seen.has(`skill:${c.name}`) || c.status === "exists")
          steps.push({ ...item("skill", c.name), action: "skip", why: "same" });
        else if (c.status !== "new") steps.push({ ...item("skill", c.name), action: "skip", why: "invalid" });
        else
          steps.push({
            ...item("skill", c.name),
            action: "add",
            ...detail,
            apply: async () => {
              const r = await call("skills.import", { source, target: "global", pick: [c.id], replace: false }, OWNER);
              const why = r.skipped[0]?.reason;
              if (!r.imported.length) throw new Error(why ?? "not copied");
            },
          });
        seen.add(`skill:${c.name}`);
      }
    }

    for (const j of p.jobs) {
      const key = `routine:${p.name}:${j.id}`;
      const schedule = scheduleOf(j);
      const prompt = [j.prompt, j.skills.length ? `Use the skills: ${j.skills.join(", ")}.` : ""]
        .filter(Boolean)
        .join("\n\n")
        .slice(0, 20_000);
      const r = records.get(key);
      const routine = r ? routines.find((x) => x.id === r.ref) : undefined;
      const want = { name: j.name.slice(0, 120), agent: slug, schedule, prompt };
      if (j.script) steps.push({ ...item("routine", j.name), action: "skip", why: "none" });
      else if (typeof schedule === "string") steps.push({ ...item("routine", j.name), action: "skip", why: schedule });
      else if (!j.prompt) steps.push({ ...item("routine", j.name), action: "skip", why: "invalid" });
      else if (!mine) steps.push({ ...item("routine", j.name), action: "skip", why: "taken", detail: slug });
      else if (r && !routine) steps.push({ ...item("routine", j.name), action: "skip", why: "removed" });
      else if (routine && r?.hash === hash(want))
        steps.push({ ...item("routine", j.name), action: "skip", why: "same" });
      else
        steps.push({
          ...item("routine", j.name),
          action: routine ? "update" : "add",
          ...(routine ? {} : { why: "off" as const }),
          apply: async () => {
            const done = await call(
              "routines.set",
              { ...want, schedule, ...(routine ? { id: routine.id, enabled: routine.enabled } : { enabled: false }) },
              OWNER,
            );
            records.set(key, { hash: hash(want), ref: done.id });
          },
        });
    }

    for (const h of p.servers) {
      const name = serverName(h.name);
      const key = `server:${name}`;
      const { server, secrets, stuck } = withoutSecrets(h);
      const r = records.get(key);
      const def = { ...server, ...(secrets.length ? { enabled: false } : {}) };
      const secret = secrets.length ? { why: "secret" as const, detail: secrets.join(", ") } : {};
      if (seen.has(key)) steps.push({ ...item("server", name), action: "skip", why: "same" });
      else if (stuck.length)
        steps.push({ ...item("server", name), action: "skip", why: "secret", detail: stuckDetail(stuck) });
      else if (servers.has(name) && !r) steps.push({ ...item("server", name), action: "skip", why: "taken" });
      else if (!servers.has(name) && r) steps.push({ ...item("server", name), action: "skip", why: "removed" });
      else if (r?.hash === hash(def)) steps.push({ ...item("server", name), action: "skip", why: "same" });
      else
        steps.push({
          ...item("server", name),
          action: r ? "update" : "add",
          ...secret,
          apply: async () => {
            await call("mcp.set", { name, server: def }, OWNER);
            records.set(key, { hash: hash(def) });
          },
        });
      seen.add(key);
    }

    for (const v of p.env) steps.push({ ...item("setting", v), action: "skip", why: "secret", detail: v });
    for (const s of p.settings)
      steps.push({ ...item("setting", s.name), action: "skip", why: s.secret ? "secret" : "none" });
  }
  return steps;
}

export const shown = ({ apply: _a, ...item }: Step): HermesItem => item;

/** Takes each step of the plan in order; one APX refuses is said and the rest still go. */
export async function applyHermes(steps: Step[]): Promise<HermesItem[]> {
  const out: HermesItem[] = [];
  for (const s of steps) {
    try {
      await s.apply?.();
      out.push(shown(s));
    } catch (err) {
      out.push({
        ...shown(s),
        action: "skip",
        why: "refused",
        detail: err instanceof Error ? err.message : String(err),
      });
    }
  }
  return out;
}
