// apx2 extensions: install a folder with apx-extension.json, turn it on or off, give it its secrets.
import type { ExtensionInfo } from "@apx/protocol";
import type { ApxClient } from "@apx/protocol/client";

const USAGE = `apx2 extensions                         Installed extensions
apx2 extensions inspect <folder>        What a folder would bring (nothing is installed)
apx2 extensions install <folder>        Copy it in, off
apx2 extensions on|off <id>
apx2 extensions secret <id> <name>      Value on stdin (rm: --clear)
apx2 extensions rm <id>`;

function show(e: ExtensionInfo): void {
  console.log(`${e.id}  ${e.name} v${e.version}  · ${e.enabled ? "on" : "off"}  · ${e.hash}`);
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
}

export async function extensions(
  client: ApxClient,
  [sub, arg, name]: string[],
  opts: { clear?: boolean | undefined },
): Promise<void> {
  if (sub === "inspect" && arg) return show(await client.call("extensions.inspect", { path: arg }));
  if (sub === "install" && arg) {
    const e = await client.call("extensions.install", { path: arg });
    show(e);
    if (!e.enabled) console.log(`\nTurn it on with: apx2 extensions on ${e.id}`);
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
      if (!value) throw new Error(`pipe the value in: … | apx2 extensions secret ${arg} ${name}`);
    }
    show(await client.call("extensions.set_secret", { id: arg, name, value }));
    return;
  }
  if (sub) throw new Error(USAGE);
  const { extensions: list } = await client.call("extensions.list", {});
  for (const e of list) show(e);
  if (!list.length) console.log(`(no extensions)\n\n${USAGE}`);
}
