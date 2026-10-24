// Integrations: connecting an account (its secrets and its MCP server as a global one, or a Google sign-in for APX's
// own tools) and disconnecting it. Where it is used is the per-project switch every global server has (mcp.toggle).
import os from "node:os";
import type { ChannelType } from "@apx/protocol";
import { CHANNEL_CATALOG } from "../channels/catalog.ts";
import type { Store } from "../domain/store.ts";
import { badRequest, notFound } from "../errors.ts";
import { ASANA_FIELD, ASANA_SECRET, type Asana } from "../integrations/asana.ts";
import {
  CATALOG,
  COMING,
  GOOGLE_INTEGRATIONS,
  integrationSecret,
  isGoogleId,
  refusesAccount,
  serverFor,
} from "../integrations/catalog.ts";
import { type Connectable, findConnectable } from "../integrations/find.ts";
import type { Google } from "../integrations/google.ts";
import type { Mcp } from "../mcp/manager.ts";
import type { Secrets } from "../secrets.ts";
import type { Handlers } from "./router.ts";

/** A folder typed as ~/… is the owner's home. */
const expand = (v: string) => (v.startsWith("~/") ? `${os.homedir()}${v.slice(1)}` : v);
const message = (e: unknown) => (e instanceof Error ? e.message : String(e));
const ASANA = { id: "asana", label: "Asana", description: "Tasks and projects of your workspace." };

export function integrationHandlers(deps: {
  store: Store;
  secrets: Secrets;
  mcp: Mcp;
  google: Google;
  asana: Asana;
  /** What asks a remote server whether it takes the owner's account (tests pass a fake). */
  fetch?: typeof fetch;
}) {
  const { store, secrets, mcp, google, asana } = deps;
  const connected = (id: string) => mcp.config.global().some((d) => d.name === id);
  /** What was typed in an integration's plain fields (a team id, a folder), to edit it later. */
  const plainOf = (id: string): Record<string, string> => {
    try {
      return JSON.parse(store.settings.get(`integration_values:${id}`) ?? "{}") as Record<string, string>;
    } catch {
      return {};
    }
  };
  const offIn = (id: string, projects: Array<{ id: string }>) =>
    projects.filter((p) => mcp.config.offIn(p.id).includes(id)).map((p) => p.id);
  /** A Google one: the shared OAuth client as its fields, and the account it is signed in as. */
  const googleEntry = (e: (typeof GOOGLE_INTEGRATIONS)[number], projects: Array<{ id: string }>) => {
    const client = google.client();
    const on = google.connected(e.id);
    const account = google.account(e.id);
    return {
      id: e.id,
      label: e.label,
      description: e.description,
      fields: [
        {
          name: "client_id",
          label: "Client id",
          secret: false,
          placeholder: "123-abc.apps.googleusercontent.com",
          url: "https://console.cloud.google.com/apis/credentials",
          ...(client.client_id ? { value: client.client_id } : {}),
        },
        { name: "client_secret", label: "Client secret", secret: true, placeholder: "GOCSPX-…", set: client.secret },
      ],
      connected: on,
      coming: false,
      off_in: on ? offIn(e.id, projects) : [],
      oauth: {
        redirect_uri: google.redirectUri(),
        ...(account ? { account } : {}),
        builtin: client.builtin,
        ...(google.clientOf(e.id) ? { client: google.clientOf(e.id) } : {}),
      },
    };
  };
  return {
    "integrations.list": () => {
      const projects = store.projects.list().filter((p) => p.path);
      return {
        integrations: [
          ...GOOGLE_INTEGRATIONS.map((e) => googleEntry(e, projects)),
          {
            ...ASANA,
            fields: [{ ...ASANA_FIELD, set: asana.connected() }],
            connected: asana.connected(),
            coming: false,
            off_in: asana.connected() ? offIn("asana", projects) : [],
          },
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
              // Editing: a secret says only that it is stored; a plain value comes back as typed.
              ...(secret
                ? { set: secrets.has(`secret://${integrationSecret(e.id, name)}`) }
                : plainOf(e.id)[name]
                  ? { value: plainOf(e.id)[name] }
                  : {}),
            })),
            connected: connected(e.id),
            coming: false,
            off_in: connected(e.id) ? offIn(e.id, projects) : [],
          })),
          ...COMING.map((c) => ({ ...c, fields: [], connected: false, coming: true, off_in: [] })),
        ],
      };
    },
    "integrations.find": ({ query }) => {
      const kept = new Set(store.settings.read("channels").map((c) => c.type));
      const integration = (e: { id: string; label: string; description: string }, on: boolean): Connectable => ({
        kind: "integration",
        id: e.id,
        label: e.label,
        description: e.description,
        connected: on,
      });
      const all: Connectable[] = [
        ...GOOGLE_INTEGRATIONS.map((e) => integration(e, google.connected(e.id))),
        integration(ASANA, asana.connected()),
        ...CATALOG.map((e) => integration(e, connected(e.id))),
        ...COMING.map((e) => ({ ...integration(e, false), coming: true })),
        ...Object.entries(CHANNEL_CATALOG).map(([id, c]) => ({
          kind: "channel" as const,
          id,
          ...c,
          connected: kept.has(id as ChannelType),
        })),
      ];
      return { found: findConnectable(all, query) };
    },
    "integrations.connect": async ({ id, values }) => {
      if (id === "asana") {
        const token = values.token?.trim();
        if (!token && !asana.connected()) throw badRequest("Asana needs its Personal access token");
        if (token) {
          await asana.validate(token);
          secrets.set(ASANA_SECRET, token);
        }
        return { connected: true as const };
      }
      if (isGoogleId(id)) throw badRequest(`${id} connects by signing in with Google`);
      const e = CATALOG.find((x) => x.id === id);
      if (!e) throw notFound(`integration ${id}`);
      // Editing a connected one, a field left empty keeps what it had.
      const was = connected(e.id);
      const kept = plainOf(e.id);
      for (const f of e.fields) {
        const typed = values[f.name]?.trim();
        const has = f.secret ? secrets.has(`secret://${integrationSecret(e.id, f.name)}`) : Boolean(kept[f.name]);
        if (!typed && !(was && has)) throw badRequest(`${e.label} needs its ${f.label}`);
      }
      for (const f of e.fields.filter((x) => x.secret)) {
        const typed = values[f.name]?.trim();
        if (typed) secrets.set(integrationSecret(e.id, f.name), typed);
      }
      const plain = Object.fromEntries(
        e.fields.filter((f) => !f.secret).map((f) => [f.name, expand(values[f.name]?.trim() || kept[f.name] || "")]),
      );
      store.settings.set(`integration_values:${e.id}`, JSON.stringify(plain));
      // The values themselves, only for asking the server here: what is stored keeps secrets by reference.
      const real = (v: string) =>
        v.replace(/\{([a-z]+)\}/g, (_m, name: string) =>
          e.fields.find((f) => f.name === name)?.secret
            ? (secrets.resolve(`secret://${integrationSecret(e.id, name)}`) ?? "")
            : (plain[name] ?? ""),
        );
      const refused =
        e.fallback && "url" in e.server
          ? await refusesAccount(
              real(e.server.url),
              Object.fromEntries(Object.entries(e.server.headers).map(([k, v]) => [k, real(v)])),
              deps.fetch,
            )
          : false;
      mcp.config.setGlobal(e.id, serverFor(e, plain, refused));
      mcp.drop({ scope: "global", name: e.id });
      return { connected: true as const };
    },
    "integrations.oauth_start": ({ id, values, also }) => {
      if (!isGoogleId(id)) throw notFound(`integration ${id} with a sign-in`);
      const more = also ?? [];
      const unknown = more.find((x) => !isGoogleId(x));
      if (unknown) throw badRequest(`${unknown} is not a Google integration`);
      try {
        return {
          url: google.start(
            id,
            { client: values?.client, client_id: values?.client_id, client_secret: values?.client_secret },
            more.filter(isGoogleId),
          ),
        };
      } catch (e) {
        throw badRequest(message(e));
      }
    },
    "integrations.oauth_finish": async ({ code, state }) => {
      try {
        const done = await google.finish(code, state);
        return {
          id: done.id,
          ...(done.also.length ? { also: done.also } : {}),
          ...(done.account ? { account: done.account } : {}),
        };
      } catch (e) {
        throw badRequest(message(e));
      }
    },
    "integrations.disconnect": ({ id }) => {
      if (id === "asana") {
        secrets.set(ASANA_SECRET, null);
        return { connected: false as const };
      }
      if (isGoogleId(id)) {
        google.disconnect(id);
        return { connected: false as const };
      }
      const e = CATALOG.find((x) => x.id === id);
      if (!e) throw notFound(`integration ${id}`);
      mcp.config.setGlobal(e.id, null);
      mcp.drop({ scope: "global", name: e.id });
      for (const f of e.fields.filter((x) => x.secret)) secrets.set(integrationSecret(e.id, f.name), null);
      store.settings.set(`integration_values:${e.id}`, "");
      return { connected: false as const };
    },
  } satisfies Partial<Handlers>;
}
