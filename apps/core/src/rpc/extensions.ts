// Extensions, for the owner: inspect a folder, an .apxext file or a URL, install it (off), go back a version, turn it
// on or off, give it its secrets.
import type { ExtensionInput, Extensions } from "../extensions/extensions.ts";
import type { Mcp } from "../mcp/manager.ts";
import type { Handlers } from "./router.ts";

/** The one place given, as the protocol checked it. */
const source = (path?: string, file?: { name: string; data: string }, url?: string): ExtensionInput =>
  path !== undefined ? { path } : file ? { file } : { url: url ?? "" };

export function extensionHandlers(extensions: Extensions, mcp: Mcp) {
  /** Its MCP servers stop now rather than at their idle timeout. */
  const dropServers = (id: string) => {
    for (const name of extensions.list().find((e) => e.id === id)?.mcp ?? []) mcp.drop({ scope: "global", name });
  };
  return {
    "extensions.list": () => ({ extensions: extensions.list() }),
    "extensions.catalog": ({ refresh }) => extensions.catalogEntries(refresh),
    "extensions.asset": async ({ id, file }) => (await extensions.asset(id, file)) ?? {},
    "extensions.inspect": ({ path, file, url }) => extensions.inspect(source(path, file, url)),
    "extensions.install": async ({ path, file, url, hash }) => {
      const before = extensions.list();
      const info = await extensions.install(source(path, file, url), hash);
      // Its servers start again with the new files at their next use; a server this version dropped stops now.
      for (const name of new Set([...(before.find((e) => e.id === info.id)?.mcp ?? []), ...info.mcp]))
        mcp.drop({ scope: "global", name });
      return info;
    },
    "extensions.rollback": ({ id }) => {
      dropServers(id);
      const info = extensions.rollback(id);
      dropServers(id);
      return info;
    },
    "extensions.enable": ({ id, enabled }) => {
      if (!enabled) dropServers(id);
      return extensions.enable(id, enabled);
    },
    "extensions.remove": ({ id }) => {
      dropServers(id);
      return { removed: extensions.remove(id) };
    },
    "extensions.test": ({ id, text }) => extensions.testContext(id, text),
    "extensions.set_secret": ({ id, name, value }) => {
      // A server started with the old value would keep it.
      dropServers(id);
      return extensions.setSecret(id, name, value);
    },
  } satisfies Partial<Handlers>;
}
