// A server the owner adds by its address from the Marketplace becomes their own extension: a connector with that
// server inside, kept in a folder APX writes under its home. Servers written in Resources stay plain servers there.
// See DECISIONS.md#d-249.
import fs from "node:fs";
import path from "node:path";

const slug = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 20)
    .replace(/-+$/, "");

/**
 * Writes the connector's folder and returns it, to install like any folder. Its id comes from the name; an id another
 * extension already uses gets a number, and adding the same address again rewrites its own folder.
 */
export function writeConnector(
  home: string,
  server: { name: string; url: string },
  taken: (id: string, dir: string) => boolean,
): string {
  const host = new URL(server.url).host;
  const base = slug(server.name) || slug(host) || "server";
  let id = base;
  for (let n = 2; taken(id, path.join(home, "connectors", id)); n++) id = `${base.slice(0, 17)}-${n}`;
  const dir = path.join(home, "connectors", id);
  fs.mkdirSync(dir, { recursive: true });
  const manifest = {
    id,
    name: server.name.trim() || host,
    version: "1.0.0",
    description: host,
    mcp: { server: { url: server.url } },
  };
  fs.writeFileSync(path.join(dir, "apx-extension.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  return dir;
}
