// apx extensions: install an extension (a folder, an .apxext file or an https URL), turn it on or off, go back a
// version, give it its secrets.
import fs from "node:fs";
import path from "node:path";
import { EXTENSION_ARCHIVE_MAX, type ExtensionInfo, type ExtensionPower } from "@apx/protocol";
import type { ApxClient } from "@apx/protocol/client";

const USAGE = `apx extensions                                   Installed extensions
apx extensions inspect <folder|file.apxext|url>  What it would bring (nothing is installed)
apx extensions install <folder|file.apxext|url>  Copy it in, off
apx extensions catalog                           What APX's catalog offers (install one by its address)
apx extensions rollback <id>                     Go back to the version installed before
apx extensions on|off <id>
apx extensions secret <id> <name>      Value on stdin (rm: --clear)
apx extensions rm <id>`;

/**
 * Where to read it from: an https address as given; an .apxext on this computer is sent whole (the core may run on
 * another one); anything else is a folder on the core's computer.
 */
function sourceOf(arg: string): { url: string } | { file: { name: string; data: string } } | { path: string } {
  if (/^https:\/\//i.test(arg)) return { url: arg };
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(arg)) throw new Error("an extension downloads only from an https address");
  if (arg.toLowerCase().endsWith(".apxext")) {
    const size = fs.statSync(arg, { throwIfNoEntry: false })?.size;
    if (size === undefined) throw new Error(`no file at ${arg}`);
    if (size > EXTENSION_ARCHIVE_MAX) throw new Error(`${arg} is larger than an extension may be`);
    return { file: { name: path.basename(arg), data: fs.readFileSync(arg).toString("base64") } };
  }
  return { path: arg };
}

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
  [sub, arg, name]: string[],
  opts: { clear?: boolean | undefined },
): Promise<void> {
  if (sub === "inspect" && arg) return show(await client.call("extensions.inspect", sourceOf(arg)));
  if (sub === "install" && arg) {
    const e = await client.call("extensions.install", sourceOf(arg));
    show(e);
    if (!e.enabled) console.log(`\nTurn it on with: apx extensions on ${e.id}`);
    return;
  }
  if (sub === "rollback" && arg) return show(await client.call("extensions.rollback", { id: arg }));
  if (sub === "catalog") {
    const r = await client.call("extensions.catalog", {});
    if (r.catalog === "unreachable") console.log("APX's catalog could not be reached.");
    if (r.catalog === "needs_update") console.log("Update APX to read its catalog.");
    for (const e of r.entries) {
      const extra = [...(e.brings ?? []), ...(e.needs ?? []).map((n) => `needs ${n}`)].join(", ");
      console.log(`${e.id}  ${e.name} v${e.version}  · ${e.provenance === "official" ? "official" : "third party"}`);
      console.log(`  ${e.description}${extra ? `\n  ${extra}` : ""}${e.url ? `\n  ${e.url}` : ""}`);
    }
    return;
  }
  if ((sub === "on" || sub === "off") && arg)
    return show(await client.call("extensions.enable", { id: arg, enabled: sub === "on" }));
  if (sub === "rm" && arg) {
    console.log((await client.call("extensions.remove", { id: arg })).removed ? "removed" : "no such extension");
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
