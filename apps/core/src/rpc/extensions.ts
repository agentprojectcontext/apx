// Extensions, for the owner: inspect a folder, an .apxext file or a URL, install it (off), go back a version, turn it
// on or off, give it its secrets.
import type { Bus } from "../bus.ts";
import type { Store } from "../domain/store.ts";
import { badRequest, conflict, notFound } from "../errors.ts";
import { activationGuard } from "../extensions/activation.ts";
import { type CatalogShown, isSuggestedCatalog, SUGGESTED } from "../extensions/catalogs.ts";
import { checkConnectionGeneration, invalidateConnection } from "../extensions/connection-generation.ts";
import type { ExtensionInput, Extensions } from "../extensions/extensions.ts";
import { isMcpRemote } from "../mcp/bridge.ts";
import { ownsExtensionName } from "../mcp/extension-names.ts";
import type { Mcp } from "../mcp/manager.ts";
import { countInstall } from "../telemetry-counts.ts";
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
  "extensions.disconnect",
  "extensions.remove",
  "extensions.add_agent",
  "extensions.set_secret",
  "extensions.settings",
  "extensions.catalog_add",
  "extensions.catalog_sync",
  "extensions.catalog_remove",
] as const;

export function extensionHandlers(extensions: Extensions, mcp: Mcp, bus: Bus, store: Store) {
  const activation = activationGuard();
  const handlers = extensionMethods(extensions, mcp, store, (id) => activation.invalidate(id));
  const told = { ...handlers };
  const serial = new Set<string>([
    "extensions.install",
    "extensions.rollback",
    "extensions.remove",
    "extensions.enable",
    "extensions.disconnect",
    "extensions.settings",
    "extensions.set_secret",
  ]);
  const current = (id: string) => {
    const found = extensions.list().find((extension) => extension.id === id);
    if (!found) throw notFound("Extension not found");
    return found;
  };
  let changing = false;
  for (const name of CHANGES) {
    const run = handlers[name] as (p: never) => unknown;
    (told as Record<string, unknown>)[name] = async (p: never) => {
      if (!serial.has(name)) {
        const out = await run(p);
        bus.emit({ type: "extensions.changed" });
        return out;
      }
      if (changing) throw conflict("Another extension is being changed; try again shortly");
      changing = true;
      try {
        let out: unknown;
        if (name === "extensions.enable") {
          const params = p as {
            id: string;
            enabled: boolean;
            only_if_disabled?: true;
            rollback_token?: string;
            connection_generation?: string;
          };
          if (params.only_if_disabled || params.connection_generation)
            checkConnectionGeneration(store, params.id, params.connection_generation);
          out = await activation.change(
            params,
            () => current(params.id),
            () => handlers["extensions.enable"](params),
          );
        } else {
          const id = (p as { id?: string }).id;
          if (id) activation.invalidate(id);
          out = await run(p);
        }
        bus.emit({ type: "extensions.changed" });
        return out;
      } finally {
        changing = false;
      }
    };
  }
  return told as typeof handlers;
}

function extensionMethods(extensions: Extensions, mcp: Mcp, store: Store, invalidateActivation: (id: string) => void) {
  const { catalogs } = extensions;
  const namesOf = (id: string) =>
    (extensions.list().find((e) => e.id === id)?.mcp ?? []).filter((name) => ownsExtensionName(store, id, name));
  /** Its MCP servers stop now rather than at their idle timeout; their grants went when they were suspended. */
  const dropServers = async (id: string) => {
    await Promise.all(namesOf(id).map((name) => mcp.drop({ scope: "global", name }, true)));
  };
  const suspendServers = async (id: string) => {
    const servers = namesOf(id).map((name) => ({
      scope: "global" as const,
      name,
    }));
    const release = mcp.suspend(servers);
    try {
      await Promise.all(servers.map((server) => mcp.drop(server)));
      return release;
    } catch (error) {
      release();
      throw error;
    }
  };
  const serversOf = (id: string) =>
    namesOf(id).flatMap((name) => {
      const def = mcp.find("global", name);
      return def?.extension_id === id ? [def] : [];
    });
  /** Its servers allow every tool the first time it is on (DECISIONS.md#d-279). */
  const openServers = (id: string) => {
    for (const d of serversOf(id)) mcp.openNew(d);
  };
  /** Who allowed each of its servers every tool, by name. */
  const openedBy = (names: string[]) =>
    new Map(
      names.flatMap((name) => {
        const d = mcp.find("global", name);
        const by = d && mcp.allowsAll(d);
        return by ? [[name, by] as const] : [];
      }),
    );
  /** A new value changes a server's definition: one that allowed all keeps allowing all, as whoever allowed it. */
  const withServersStopped = async <T>(id: string, fn: () => T | Promise<T>): Promise<T> => {
    const open = openedBy(serversOf(id).map((d) => d.name));
    const release = await suspendServers(id);
    try {
      invalidateConnection(store, id);
      return await fn();
    } finally {
      release();
      for (const d of serversOf(id)) {
        const by = open.get(d.name);
        if (by) mcp.openNew(d, true, by);
      }
    }
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
      return withServersStopped(id, () => extensions.setSettings(id, values));
    },
    "extensions.page": ({ id, page }) => extensions.page(id, page),
    "extensions.companion_file": ({ id }) => extensions.companionFile(id),
    "extensions.app_bundle": ({ id, file }) => extensions.appBundle(id, file),
    "extensions.asset": async ({ id, file }) => (await extensions.asset(id, file)) ?? {},
    "extensions.pack": ({ path }) => extensions.pack(path),
    "extensions.inspect": ({ path, file, url, entry }) => extensions.inspect(source(path, file, url, entry)),
    "extensions.install": async (params) => {
      const { path, file, url, entry, server, hash } = params;
      const before = new Map(extensions.list().map((e) => [e.id, namesOf(e.id)]));
      const open = openedBy([...before.values()].flat());
      const from = server ? { path: extensions.connector(server) } : source(path, file, url, entry);
      const info = await extensions.install(from, hash, async (id) => {
        const release = await suspendServers(id);
        // Only this package is about to change; even a partial replacement supersedes its old activation.
        invalidateActivation(id);
        invalidateConnection(store, id);
        return release;
      });
      invalidateActivation(info.id);
      countInstall(store, params, info, entry ? isSuggestedCatalog(entry.catalog) : false);
      // Its servers start again with the new files at their next use; a server this version dropped stops now.
      const names = [...new Set([...(before.get(info.id) ?? []), ...namesOf(info.id)])];
      await Promise.all(names.map((name) => mcp.drop({ scope: "global", name })));
      // An update keeps "allow all" for the servers that had it, once the extension is on.
      for (const [name, by] of open) if (names.includes(name)) mcp.forgetOpened({ scope: "global", name }, by);
      if (info.enabled) openServers(info.id);
      return info;
    },
    "extensions.rollback": async ({ id }) => {
      const info = await withServersStopped(id, () => extensions.rollback(id));
      await dropServers(id);
      return info;
    },
    "extensions.enable": async ({ id, enabled }) => {
      if (!enabled) {
        // Turned off and on again, a server that allowed all is new once more; one the owner set to ask stays so.
        const open = openedBy(serversOf(id).map((d) => d.name));
        const info = await withServersStopped(id, () => extensions.enable(id, enabled));
        for (const [name, by] of open) mcp.forgetOpened({ scope: "global", name }, by);
        return info;
      }
      const info = extensions.enable(id, enabled);
      openServers(id);
      return info;
    },
    "extensions.disconnect": async ({ id }) => {
      const info = extensions.list().find((e) => e.id === id);
      if (!info) throw notFound("Extension not found");
      if (!info.session?.can_disconnect) throw badRequest("This extension has no managed sign-in session");
      const record = store.extensions.get(id);
      if (!record) throw notFound("Extension not found");
      const servers = Object.entries(record.manifest.mcp)
        .filter(([, server]) => isMcpRemote(server))
        .map(([name]) => ({ scope: "global" as const, name: `${id}-${name}`, extension_id: id }));
      return withServersStopped(id, () => {
        // Persist before deletion: even a partial filesystem failure must not restart the bridge.
        mcp.requireSignIn(servers);
        return extensions.disconnect(id);
      });
    },
    "extensions.remove": async ({ id }) => {
      const servers = namesOf(id).map((name) => ({
        scope: "global" as const,
        name,
      }));
      const out = await withServersStopped(id, () => extensions.remove(id));
      for (const d of servers) mcp.forgetOpened(d);
      return out;
    },
    "extensions.add_agent": ({ id, agent }) => extensions.addAgent(id, agent),
    "extensions.test": ({ id, text }) => extensions.testContext(id, text),
    "extensions.set_secret": async ({ id, name, value }) => {
      // A server started with the old value would keep it.
      return withServersStopped(id, () => extensions.setSecret(id, name, value));
    },
  } satisfies Partial<Handlers>;
}
