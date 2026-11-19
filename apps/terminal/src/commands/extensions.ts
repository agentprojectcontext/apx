// apx extensions: install an extension (a folder, an .apxext file or an https URL), turn it on or off, go back a
// version, give it its secrets.
import fs from "node:fs";
import path from "node:path";
import { EXTENSION_ARCHIVE_MAX, type ExtensionInfo, type ExtensionPower } from "@apx/protocol";
import type { ApxClient } from "@apx/protocol/client";

const USAGE = `apx extensions                                   Installed extensions
apx extensions inspect <folder|file.apxext|url|catalog:<catalog>/<id>>  What it would bring (nothing is installed)
apx extensions install <folder|file.apxext|url|catalog:<catalog>/<id>>  Copy it in, off
apx extensions pack <folder> [file.apxext]       One file to share or install (<id>-<version>.apxext)
apx extensions catalog                           What APX's catalog and yours offer (install one by its address)
apx extensions catalogs [add <source>|sync <id>|rm <id>]  Your own catalogs (owner/repo, git, https index, folder)
apx extensions set <id> name=value ...           Its settings (value "-": read from stdin, for a sensitive one)
apx extensions rollback <id>                     Go back to the version installed before
apx extensions on|off <id>
apx extensions secret <id> <name>      Value on stdin (rm: --clear)
apx extensions rm <id>`;

/**
 * Where to read it from: an https address as given; an .apxext on this computer is sent whole (the core may run on
 * another one); anything else is a folder on the core's computer.
 */
function sourceOf(
  arg: string,
):
  | { url: string }
  | { file: { name: string; data: string } }
  | { path: string }
  | { entry: { catalog: string; id: string } } {
  if (/^https:\/\//i.test(arg)) return { url: arg };
  const entry = /^catalog:([^/]+)\/(.+)$/.exec(arg);
  if (entry?.[1] && entry[2]) return { entry: { catalog: entry[1], id: entry[2] } };
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(arg)) throw new Error("an extension downloads only from an https address");
  if (arg.toLowerCase().endsWith(".apxext")) {
    const size = fs.statSync(arg, { throwIfNoEntry: false })?.size;
    if (size === undefined) throw new Error(`no file at ${arg}`);
    if (size > EXTENSION_ARCHIVE_MAX) throw new Error(`${arg} is larger than an extension may be`);
    return { file: { name: path.basename(arg), data: fs.readFileSync(arg).toString("base64") } };
  }
  return { path: folderPath(arg) };
}

/** A folder as the person typed it: relative to where they are (the core resolves "~" on its own computer). */
const folderPath = (arg: string) => (arg.startsWith("~") ? arg : path.resolve(arg));

const POWER: Record<ExtensionPower["kind"], string> = {
  mcp: "MCP server",
  host: "reaches",
  secret: "asks for secret",
  routine: "routine",
  plugin: "plugin",
  internet: "plugin reaches the internet",
  local_network: "plugin reaches your local network",
  context: "plugin adds context to turns",
  observe: "plugin watches",
};
const power = (p: ExtensionPower) =>
  ["internet", "local_network", "context"].includes(p.kind) ? POWER[p.kind] : `${POWER[p.kind]} ${p.name}`;

function show(e: ExtensionInfo): void {
  const from = e.provenance === "official" ? "official" : "third party";
  console.log(`${e.id}  ${e.name} v${e.version}  · ${e.enabled ? "on" : "off"}  · ${from}  · ${e.hash}`);
  if (e.catalog === "unreachable") console.log("  the APX catalog could not be reached: shown as third party");
  if (e.catalog === "needs_update") console.log("  the APX catalog needs a newer APX: shown as third party");
  if (e.description) console.log(`  ${e.description}`);
  if (e.skills.length) console.log(`  skills: ${e.skills.join(", ")}`);
  if (e.mcp.length) console.log(`  mcp: ${e.mcp.join(", ")}`);
  if (e.routines.length) console.log(`  routines: ${e.routines.map((r) => r.name).join(", ")}`);
  for (const s of e.secrets) console.log(`  secret ${s.name}: ${s.label} (${s.set ? "set" : "missing"})`);
  if (e.plugin)
    console.log(
      `  plugin: ${e.plugin.status}${e.plugin.error ? ` (${e.plugin.error})` : ""}; watches ${e.plugin.observe.join(", ") || "nothing"}${e.plugin.context ? "; adds context" : ""}${e.plugin.network ? "; internet" : ""}`,
    );
  for (const s of e.settings)
    console.log(
      `  setting ${s.name}: ${s.label} (${s.sensitive ? (s.set ? "set" : "missing") : s.value === undefined ? "missing" : JSON.stringify(s.value)})`,
    );
  for (const a of e.agents) console.log(`  agent ${a.name}`);
  for (const a of e.apps) console.log(`  app ${a.name ?? a.file}`);
  if (e.companion) console.log(`  companion app: ${e.companion.name} (${e.companion.platform})`);
  if (e.unsupported) console.log("  does not run on this computer's system");
  if (e.runs_code) console.log("  runs code on this computer: turn it on only if you trust its author");
  if (e.update) {
    console.log(`  over v${e.update.from}:`);
    for (const p of e.update.adds) console.log(`    + ${power(p)}`);
    for (const p of e.update.removes) console.log(`    - ${power(p)}`);
    if (e.update.keeps_on !== undefined)
      console.log(`    ${e.update.keeps_on ? "stays on" : "will be off until you turn it on"}`);
  }
}

export async function extensions(
  client: ApxClient,
  [sub, arg, name, ...more]: string[],
  opts: { clear?: boolean | undefined },
): Promise<void> {
  const rest = name === undefined ? [] : [name, ...more];
  if (sub === "inspect" && arg) return show(await client.call("extensions.inspect", sourceOf(arg)));
  if (sub === "install" && arg) {
    const e = await client.call("extensions.install", sourceOf(arg));
    show(e);
    if (!e.enabled) console.log(`\nTurn it on with: apx extensions on ${e.id}`);
    return;
  }
  if (sub === "pack" && arg) {
    const p = await client.call("extensions.pack", { path: folderPath(arg) });
    const out = path.resolve(name ?? p.name);
    if (!out.toLowerCase().endsWith(".apxext")) throw new Error("the file must end in .apxext");
    fs.writeFileSync(out, Buffer.from(p.data, "base64"));
    console.log(`${out}  ${(p.size / 1024).toFixed(0)} KB  · ${p.hash}`);
    console.log(`\nInstall it with: apx extensions install ${path.relative(process.cwd(), out) || out}`);
    return;
  }
  if (sub === "rollback" && arg) return show(await client.call("extensions.rollback", { id: arg }));
  if (sub === "set" && arg && rest.length) {
    const values: Record<string, string> = {};
    for (const pair of rest) {
      const at = pair.indexOf("=");
      if (at < 1) throw new Error(USAGE);
      let value = pair.slice(at + 1);
      // From stdin, never argv, for a sensitive one (it would show up in the process list and shell history).
      if (value === "-") {
        value = "";
        for await (const chunk of process.stdin) value += String(chunk);
        value = value.trim();
      }
      values[pair.slice(0, at)] = value;
    }
    return show(await client.call("extensions.settings", { id: arg, values }));
  }
  if (sub === "catalogs") {
    const show1 = (c: {
      id: string;
      name: string;
      source: string;
      count: number;
      skipped: { name: string; reason: string }[];
      synced_sha?: string | undefined;
    }) => {
      console.log(`${c.id}  ${c.name}  · ${c.count} extensions${c.synced_sha ? ` · ${c.synced_sha.slice(0, 7)}` : ""}`);
      console.log(`  ${c.source}`);
      for (const s of c.skipped) console.log(`  left out ${s.name}: ${s.reason}`);
    };
    if (arg === "add" && name) return show1(await client.call("extensions.catalog_add", { source: name }));
    if (arg === "sync" && name) return show1(await client.call("extensions.catalog_sync", { id: name }));
    if (arg === "rm" && name) {
      console.log(
        (await client.call("extensions.catalog_remove", { id: name })).removed ? "removed" : "no such catalog",
      );
      return;
    }
    if (arg) throw new Error(USAGE);
    const r = await client.call("extensions.catalogs", {});
    for (const c of r.catalogs) show1(c);
    if (!r.catalogs.length) console.log("(no catalogs of your own)");
    console.log("\nSuggested:");
    for (const g of r.suggested) console.log(`  apx extensions catalogs add ${g.source}   ${g.name}`);
    return;
  }
  if (sub === "catalog") {
    const r = await client.call("extensions.catalog", {});
    if (r.catalog === "unreachable") console.log("APX's catalog could not be reached.");
    if (r.catalog === "needs_update") console.log("Update APX to read its catalog.");
    for (const e of r.entries) {
      const extra = [...(e.brings ?? []), ...(e.needs ?? []).map((n) => `needs ${n}`)].join(", ");
      console.log(
        `${e.id}  ${e.name}${e.version === "0.0.0" ? "" : ` v${e.version}`}  · ${e.provenance === "official" ? "official" : "third party"}`,
      );
      const from = e.url ?? (e.catalog ? `catalog:${e.catalog}/${e.id}` : "");
      console.log(`  ${e.description}${extra ? `\n  ${extra}` : ""}${from ? `\n  ${from}` : ""}`);
    }
    return;
  }
  if ((sub === "on" || sub === "off") && arg)
    return show(await client.call("extensions.enable", { id: arg, enabled: sub === "on" }));
  if (sub === "rm" && arg) {
    const r = await client.call("extensions.remove", { id: arg });
    console.log(r.removed ? "removed" : "no such extension");
    if (r.archived.length) console.log(`archived the agents added from it: ${r.archived.join(", ")}`);
    if (r.kept.length) console.log(`kept, they answer a channel: ${r.kept.join(", ")}`);
    return;
  }
  if (sub === "secret" && arg && name) {
    let value: string | null = null;
    if (!opts.clear) {
      // From stdin, never argv (it would show up in the process list and shell history).
      let raw = "";
      for await (const chunk of process.stdin) raw += String(chunk);
      value = raw.trim();
      if (!value) throw new Error(`pipe the value in: … | apx extensions secret ${arg} ${name}`);
    }
    show(await client.call("extensions.set_secret", { id: arg, name, value }));
    return;
  }
  if (sub) throw new Error(USAGE);
  const { extensions: list } = await client.call("extensions.list", {});
  for (const e of list) show(e);
  if (!list.length) console.log(`(no extensions)\n\n${USAGE}`);
}
