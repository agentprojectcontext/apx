// apx owner / org / profiles: who the owner is, a project's areas and roles, and what the super-agent is for.
import type { ApxClient } from "@apx/protocol/client";

export const USAGE = {
  owner: `apx owner                                  Who you are, for your agents
apx owner set key=value…                   name, about, language (es, en…), timezone (America/New_York; "" = this machine's)`,
  org: `apx org [--project p]                      A project's areas and roles (no project: the base project's)
apx org set [--project p] < org.json       Replace them: {"areas": [{"slug", "name"}], "roles": [{"slug", "name", "area"}]}`,
  profiles: `apx profiles [list]                        Profiles, the one the super-agent runs and the routines it keeps
apx profiles use <id> [key=value…]         Run a profile; values are its settings (apx profiles lists them)
apx profiles off                           Run none: the super-agent only answers
apx profiles restore <routine>             Put back a profile routine's default prompt`,
};

const OWNER_KEYS = ["name", "about", "language", "timezone"] as const;

/** key=value pairs, in order; the value may hold "=" and may be empty. */
export function pairsOf(pairs: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const p of pairs) {
    const i = p.indexOf("=");
    if (i < 1) throw new Error(`expected key=value, got "${p}"`);
    out[p.slice(0, i)] = p.slice(i + 1);
  }
  return out;
}

/** owner.set params for `apx owner set`: only the identity's own keys. */
export function ownerPatchOf(pairs: string[]) {
  const patch = pairsOf(pairs);
  const unknown = Object.keys(patch).filter((k) => !(OWNER_KEYS as readonly string[]).includes(k));
  if (!pairs.length || unknown.length)
    throw new Error(`${unknown.length ? `unknown: ${unknown.join(", ")}\n\n` : ""}${USAGE.owner}`);
  return patch;
}

export async function owner(client: ApxClient, [sub, ...pairs]: string[]) {
  if (sub === "help") {
    console.log(USAGE.owner);
    return;
  }
  if (sub && sub !== "set") throw new Error(USAGE.owner);
  const me = sub === "set" ? await client.call("owner.set", ownerPatchOf(pairs)) : await client.call("owner.get", {});
  console.log(`Name:      ${me.name || "(not set)"}`);
  console.log(`Language:  ${me.language}`);
  console.log(`Time zone: ${me.timezone || "this machine's"}`);
  if (me.about.trim()) console.log(`\n${me.about.trim()}`);
}

async function readStdin(): Promise<string> {
  let raw = "";
  for await (const chunk of process.stdin) raw += String(chunk);
  return raw;
}

export async function org(client: ApxClient, [sub]: string[], o: { project?: string | undefined }, read = readStdin) {
  if (sub === "help") {
    console.log(USAGE.org);
    return;
  }
  if (sub && sub !== "set") throw new Error(USAGE.org);
  const project = o.project ? { project: o.project } : {};
  const organization =
    sub === "set"
      ? await client.call("org.set", { ...project, organization: JSON.parse(await read()) })
      : await client.call("org.get", project);
  for (const area of [...organization.areas, undefined]) {
    const roles = organization.roles.filter((r) =>
      area ? r.area === area.slug : !organization.areas.some((a) => a.slug === r.area),
    );
    if (!area && !roles.length) continue;
    console.log(area ? `\n${area.name} (${area.slug})${area.goal ? `  · ${area.goal}` : ""}` : "\nGeneral");
    for (const r of roles) console.log(`  ${r.slug.padEnd(20)} ${r.name}`);
  }
  if (!organization.areas.length && !organization.roles.length) console.log(`(no areas or roles)\n\n${USAGE.org}`);
}

export async function profiles(client: ApxClient, [sub, id, ...pairs]: string[]) {
  if (sub === "help") {
    console.log(USAGE.profiles);
    return;
  }
  if (sub === "restore") {
    if (!id) throw new Error(USAGE.profiles);
    const r = await client.call("profiles.restore", { routine: id });
    console.log(`${r.id}  ${r.name}: default prompt restored`);
    return;
  }
  if (sub === "off") {
    await client.call("profiles.set", { id: null, values: {} });
    console.log("no profile: the super-agent only answers");
    return;
  }
  const list = await client.call("profiles.list", {});
  if (sub === "use") {
    const profile = list.profiles.find((p) => p.id === id);
    if (!profile) throw new Error(`no profile ${id ?? ""}\n\n${USAGE.profiles}`);
    const given = pairsOf(pairs);
    const fields = new Map(profile.settings.map((f) => [f.key, f]));
    const unknown = Object.keys(given).filter((k) => !fields.has(k));
    if (unknown.length)
      throw new Error(`${profile.id} has no setting ${unknown.join(", ")} (it has: ${[...fields.keys()].join(", ")})`);
    // values replaces the whole set: the running profile's values stay unless given again.
    const values: Record<string, string | number> = list.active.id === profile.id ? { ...list.active.values } : {};
    for (const [k, v] of Object.entries(given)) values[k] = fields.get(k)?.type === "number" ? Number(v) : v;
    const r = await client.call("profiles.set", { id: profile.id, values });
    console.log(`${profile.name.en} runs · ${r.routines.length} routine(s)`);
    for (const t of r.routines) console.log(`  ${t.id}  ${t.name}${t.enabled ? "" : "  · off"}`);
    return;
  }
  if (sub && sub !== "list") throw new Error(USAGE.profiles);
  for (const p of list.profiles) {
    const active = p.id === list.active.id;
    console.log(`${active ? "*" : " "} ${p.id.padEnd(16)} ${p.name.en}${p.source === "owner" ? "  · installed" : ""}`);
    for (const f of p.settings) {
      const value = active && f.key in list.active.values ? list.active.values[f.key] : f.default;
      console.log(`    ${f.key.padEnd(24)} ${String(value) || "(empty)"}`);
    }
  }
  if (!list.active.id) console.log("\nNo profile runs: the super-agent only answers.");
  if (list.routines.length) console.log("\nRoutines it keeps");
  for (const t of list.routines) console.log(`  ${t.id}  ${t.name}${t.enabled ? "" : "  · off"}`);
}
