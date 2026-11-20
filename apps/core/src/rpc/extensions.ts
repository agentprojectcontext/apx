// Extensions, for the owner: inspect a folder, an .apxext file or a URL, install it (off), go back a version, turn it
// on or off, give it its secrets.
import type { Bus } from "../bus.ts";
import { type CatalogShown, SUGGESTED } from "../extensions/catalogs.ts";
import type { ExtensionInput, Extensions } from "../extensions/extensions.ts";
import type { Mcp } from "../mcp/manager.ts";
import type { Handlers } from "./router.ts";

/** The one place given, as the protocol checked it. */
const source = (
  path?: string,
  file?: { name: string; data: string },
  url?: string,
  entry?: { catalog: string; id: string },
): ExtensionInput => (path !== undefined ? { path } : file ? { file } : entry ? { entry } : { url: url ?? "" });

/** An added catalog as the owner sees it. */
const shown = (c: CatalogShown) => ({
  id: c.id,
  name: c.name,
  source: c.source,
  kind: c.kind,
  ...(c.ref ? { ref: c.ref } : {}),
  ...(c.synced_sha ? { synced_sha: c.synced_sha } : {}),
  ...(c.synced_at ? { synced_at: c.synced_at } : {}),
  count: c.entries.length,
  ...(c.reading ? { reading: c.reading } : {}),
  ...(c.failed ? { failed: c.failed } : {}),
  skipped: c.skipped,
});

/** The methods that change what the owner has: an open Marketplace anywhere hears of it. */
const CHANGES = [
  "extensions.install",
  "extensions.rollback",
  "extensions.enable",
  "extensions.remove",
  "extensions.add_agent",
  "extensions.set_secret",
  "extensions.settings",
  "extensions.catalog_add",
  "extensions.catalog_sync",
  "extensions.catalog_remove",
] as const;

export function extensionHandlers(extensions: Extensions, mcp: Mcp, bus: Bus) {
  const handlers = extensionMethods(extensions, mcp);
  const told = { ...handlers };
  for (const name of CHANGES) {
    const run = handlers[name] as (p: never) => unknown;
    (told as Record<string, unknown>)[name] = async (p: never) => {
      const out = await run(p);
      bus.emit({ type: "extensions.changed" });
      return out;
    };
  }
  return told as typeof handlers;
}

function extensionMethods(extensions: Extensions, mcp: Mcp) {
  const { catalogs } = extensions;
  /** Its MCP servers stop now rather than at their idle timeout. */
  const dropServers = async (id: string) => {
    await Promise.all(
      (extensions.list().find((e) => e.id === id)?.mcp ?? []).map((name) => mcp.drop({ scope: "global", name })),
    );
  };
  return {
    "extensions.list": () => ({ extensions: extensions.list() }),
    "extensions.catalogs": () => ({ catalogs: catalogs.list().map(shown), suggested: SUGGESTED }),
    "extensions.catalog_add": async ({ source: text, background }) => shown(await catalogs.add(text, background)),
    "extensions.catalog_sync": async ({ id, background }) => shown(await catalogs.sync(id, background)),
    "extensions.catalog_remove": ({ id }) => ({ removed: catalogs.remove(id) }),
    "extensions.catalog": ({ refresh }) => extensions.catalogEntries(refresh),
    "extensions.settings": async ({ id, values }) => {
      // Its servers start again with the new values at their next use.
      await dropServers(id);
      return extensions.setSettings(id, values);
    },
    "extensions.page": ({ id, page }) => extensions.page(id, page),
    "extensions.companion_file": ({ id }) => extensions.companionFile(id),
    "extensions.app_bundle": ({ id, file }) => extensions.appBundle(id, file),
    "extensions.asset": async ({ id, file }) => (await extensions.asset(id, file)) ?? {},
    "extensions.pack": ({ path }) => extensions.pack(path),
    "extensions.inspect": ({ path, file, url, entry }) => extensions.inspect(source(path, file, url, entry)),
    "extensions.install": async ({ path, file, url, entry, server, hash }) => {
      const before = extensions.list();
      const from = server ? { path: extensions.connector(server) } : source(path, file, url, entry);
      const info = await extensions.install(from, hash, dropServers);
      // Its servers start again with the new files at their next use; a server this version dropped stops now.
      await Promise.all(
        [...new Set([...(before.find((e) => e.id === info.id)?.mcp ?? []), ...info.mcp])].map((name) =>
          mcp.drop({ scope: "global", name }),
        ),
      );
      return info;
    },
    "extensions.rollback": async ({ id }) => {
      await dropServers(id);
      const info = extensions.rollback(id);
      await dropServers(id);
      return info;
    },
    "extensions.enable": async ({ id, enabled }) => {
      if (!enabled) await dropServers(id);
      return extensions.enable(id, enabled);
    },
    "extensions.remove": async ({ id }) => {
      await dropServers(id);
      return extensions.remove(id);
    },
    "extensions.add_agent": ({ id, agent }) => extensions.addAgent(id, agent),
    "extensions.test": ({ id, text }) => extensions.testContext(id, text),
    "extensions.set_secret": async ({ id, name, value }) => {
      // A server started with the old value would keep it.
      await dropServers(id);
      return extensions.setSecret(id, name, value);
    },
  } satisfies Partial<Handlers>;
}
