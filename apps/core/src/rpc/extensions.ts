// Extensions, for the owner: inspect a folder, install it (off), turn it on or off, give it its secrets.
import type { Extensions } from "../extensions/extensions.ts";
import type { Mcp } from "../mcp/manager.ts";
import type { Handlers } from "./router.ts";

export function extensionHandlers(extensions: Extensions, mcp: Mcp) {
  /** Its MCP servers stop now rather than at their idle timeout. */
  const dropServers = (id: string) => {
    for (const name of extensions.list().find((e) => e.id === id)?.mcp ?? []) mcp.drop({ scope: "global", name });
  };
  return {
    "extensions.list": () => ({ extensions: extensions.list() }),
    "extensions.inspect": ({ path }) => extensions.inspect(path),
    "extensions.install": ({ path }) => {
      const info = extensions.install(path);
      if (!info.enabled) dropServers(info.id);
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
