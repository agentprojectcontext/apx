// Integrations: connecting an account (its secrets and its MCP server as a global one) and disconnecting it. Where it
// is used is the per-project switch every global server has (mcp.toggle).
import os from "node:os";
import type { Store } from "../domain/store.ts";
import { badRequest, notFound } from "../errors.ts";
import { CATALOG, COMING, integrationSecret, serverFor } from "../integrations/catalog.ts";
import type { Mcp } from "../mcp/manager.ts";
import type { Secrets } from "../secrets.ts";
import type { Handlers } from "./router.ts";

/** A folder typed as ~/… is the owner's home. */
const expand = (v: string) => (v.startsWith("~/") ? `${os.homedir()}${v.slice(1)}` : v);

export function integrationHandlers(deps: { store: Store; secrets: Secrets; mcp: Mcp }) {
  const { store, secrets, mcp } = deps;
  const connected = (id: string) => mcp.config.global().some((d) => d.name === id);
  return {
    "integrations.list": () => {
      const projects = store.projects.list().filter((p) => p.path);
      return {
        integrations: [
          ...CATALOG.map((e) => ({
            id: e.id,
            label: e.label,
            description: e.description,
            fields: e.fields.map(({ name, label, secret, placeholder, url }) => ({
              name,
              label,
              secret,
              ...(placeholder ? { placeholder } : {}),
              ...(url ? { url } : {}),
            })),
            connected: connected(e.id),
            coming: false,
            off_in: connected(e.id)
              ? projects.filter((p) => mcp.config.offIn(p.id).includes(e.id)).map((p) => p.id)
              : [],
          })),
          ...COMING.map((c) => ({ ...c, fields: [], connected: false, coming: true, off_in: [] })),
        ],
      };
    },
    "integrations.connect": ({ id, values }) => {
      const e = CATALOG.find((x) => x.id === id);
      if (!e) throw notFound(`integration ${id}`);
      for (const f of e.fields) if (!values[f.name]?.trim()) throw badRequest(`${e.label} needs its ${f.label}`);
      for (const f of e.fields.filter((x) => x.secret))
        secrets.set(integrationSecret(e.id, f.name), (values[f.name] ?? "").trim());
      const plain = Object.fromEntries(
        e.fields.filter((f) => !f.secret).map((f) => [f.name, expand((values[f.name] ?? "").trim())]),
      );
      mcp.config.setGlobal(e.id, serverFor(e, plain));
      mcp.drop({ scope: "global", name: e.id });
      return { connected: true as const };
    },
    "integrations.disconnect": ({ id }) => {
      const e = CATALOG.find((x) => x.id === id);
      if (!e) throw notFound(`integration ${id}`);
      mcp.config.setGlobal(e.id, null);
      mcp.drop({ scope: "global", name: e.id });
      for (const f of e.fields.filter((x) => x.secret)) secrets.set(integrationSecret(e.id, f.name), null);
      return { connected: false as const };
    },
  } satisfies Partial<Handlers>;
}
