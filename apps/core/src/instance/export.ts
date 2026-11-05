// This setup as one file: what the owner made in APX, in the shape the import reads back. The same shapes are what an
// import compares with, so a file brought back unchanged reads as unchanged. See DECISIONS.md#d-192
import fs from "node:fs";
import path from "node:path";
import {
  INSTANCE_FORMAT,
  INSTANCE_MAX_BYTES,
  INSTANCE_VERSION,
  InstanceAgent,
  InstanceChannel,
  type InstanceChat,
  type InstanceFile,
  type InstanceFlow,
  type InstanceMcp,
  InstanceMemory,
  type InstanceProject,
  InstanceRoutine,
  type InstanceSkill,
  type InstanceTable,
  type Memory,
  type Routine,
} from "@apx/protocol";
import { OAUTH_CHATGPT } from "../config.ts";
import type { AgentRecord } from "../domain/agents.ts";
import type { ProjectRecord } from "../domain/projects.ts";
import type { SettingKey } from "../domain/setting-keys.ts";
import type { Store } from "../domain/store.ts";
import type { McpDef } from "../mcp/config.ts";
import { mcpConfig } from "../mcp/config.ts";
import { tildeHome } from "../paths.ts";
import { NO_KEY } from "../providers/llm.ts";
import type { Secrets } from "../secrets.ts";
import { carriesSecret, knownSecrets, scrubbed } from "./scrub.ts";

/** The owner's preferences that travel; each is read and written through its own schema. */
export const MOVED_SETTINGS = [
  "owner_profile",
  "base_project",
  "base_org",
  "task_columns",
  "notices",
  "agent_limits",
  "memory",
  "image_defaults",
  "skills_off",
  "mcp_off",
  "model_default",
  "model_router",
  "project_helper",
  "email_signatures",
  "email_signature_default",
  "calendar_reminders",
  "mail_check",
] as const satisfies readonly SettingKey[];
/** Of those, the ones that act through a sign-in (Google): they arrive off. */
export const SIGNED_IN_SETTINGS: ReadonlySet<string> = new Set(["calendar_reminders", "mail_check"]);
/** Plain-text settings that travel. */
export const MOVED_TEXT_SETTINGS = ["owner_language"] as const;

/**
 * The chats that travel when the owner ticks them: not a task's, a routine's, a contact's, a delegation's or a code
 * session's (it works in a folder of this computer).
 */
const CHAT_KINDS = new Set(["home", "agent", "loose", "group"]);
const SKILL_FILES = 200;
const SKILL_FILE_BYTES = 1_000_000;

export type InstanceDeps = {
  store: Store;
  secrets: Pick<Secrets, "list" | "resolve">;
  /** The APX home: the owner's skills are under it. */
  home: string;
  /** The person's home folder, written as `~` in paths. */
  userHome: string;
  version: string;
  now?: () => Date;
};

export const agentShape = (a: AgentRecord): InstanceFile["agents"][number] => InstanceAgent.parse(a);

const projectShape = (p: ProjectRecord, userHome: string): InstanceProject => ({
  id: p.id,
  name: p.name,
  ...(p.path ? { path: tildeHome(p.path, userHome) } : {}),
  ...(p.description ? { description: p.description } : {}),
  ...(p.kind ? { kind: p.kind } : {}),
  ...(p.autonomy ? { autonomy: p.autonomy } : {}),
  ...(p.read_only_folders?.length ? { read_only_folders: p.read_only_folders.map((f) => tildeHome(f, userHome)) } : {}),
});

export const routineShape = (r: Routine) => InstanceRoutine.parse(r);
const memoryShape = (m: Memory) => InstanceMemory.parse(m);

/** A variable's value travels only as a reference: one typed as text (a password in a URL, say) goes empty. */
const references = (r: Record<string, string>) =>
  Object.fromEntries(Object.entries(r).map(([k, v]) => [k, v.includes("secret://") || v.startsWith("env:") ? v : ""]));
/** An address without the user and password some carry before the host. */
const noSignIn = (url: string) => url.replace(/^([a-z][a-z0-9+.-]*:\/\/)[^/@\s]*@/i, "$1");

export const mcpShape = (d: McpDef): InstanceMcp => ({
  name: d.name,
  ...(d.command ? { command: d.command } : {}),
  args: d.args,
  env: references(d.env),
  ...(d.url ? { url: noSignIn(d.url) } : {}),
  headers: references(d.headers),
  ...(d.only ? { project: d.only } : {}),
  enabled: d.enabled,
});

/** A provider's key stays only as a reference (or "none", or a sign-in): a key typed in as text is left out. */
export const providerShape = (p: Record<string, unknown>) => {
  const key =
    typeof p.key === "string" && (/^(secret:\/\/|env:)/.test(p.key) || p.key === NO_KEY || p.key === OAUTH_CHATGPT)
      ? p.key
      : "";
  return { ...p, key };
};

/** The owner's own MCP servers (not a project's file nor an extension's). */
export const ownMcps = (store: Store) =>
  mcpConfig(store)
    .global()
    .filter((d) => d.own);

function tableShape(store: Store, project: string, name: string, rows: boolean): InstanceTable | undefined {
  const t = store.flowTables.get(project, name);
  if (!t) return undefined;
  return {
    project_id: t.project,
    name: t.name,
    columns: t.columns,
    required: t.required,
    ...(rows ? { rows: allTableRows(store, project, name) } : {}),
  };
}

/** Oldest first, so an import writes them back in the order they were saved. */
function allTableRows(store: Store, project: string, name: string) {
  const out: Array<{ key: string; value: unknown }> = [];
  let cursor: string | undefined;
  for (;;) {
    const page = store.flowTables.latest(project, name, 500, cursor);
    out.push(...page.map((r) => ({ key: r.key, value: r.value })));
    const last = page.at(-1);
    if (page.length < 500 || !last) break;
    cursor = `${last.updated_at}|${last.key}`;
  }
  return out.reverse();
}

function flowShape(store: Store, id: string, rows: boolean): InstanceFlow | undefined {
  const definition = store.flows.get(id);
  if (!definition) return undefined;
  const doc = store.flowGraphs.get(id);
  const own: Array<{ key: string; value: unknown }> = [];
  if (rows) {
    let cursor = "";
    for (;;) {
      const page = store.flows.rows(id, 500, cursor);
      own.push(...page);
      if (page.length < 500) break;
      cursor = page.at(-1)?.key ?? "";
    }
  }
  return { definition, graph: doc.published ?? doc.draft, ...(rows ? { rows: own } : {}) };
}

/** A skill's text files, as paths inside its folder; a link or a file that is not text is left out. */
export function readSkill(dir: string): InstanceSkill["files"] {
  const files: InstanceSkill["files"] = [];
  const walk = (at: string) => {
    for (const e of fs.readdirSync(at, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      if (files.length >= SKILL_FILES || e.name.startsWith(".")) continue;
      const full = path.join(at, e.name);
      if (e.isDirectory()) walk(full);
      else if (e.isFile() && fs.statSync(full).size <= SKILL_FILE_BYTES) {
        const text = fs.readFileSync(full, "utf8");
        if (!text.includes("\u0000") && !text.includes("�"))
          files.push({ path: path.relative(dir, full).split(path.sep).join("/"), text });
      }
    }
  };
  walk(dir);
  return files;
}

function skills(home: string): InstanceSkill[] {
  const root = path.join(home, "skills");
  if (!fs.existsSync(root)) return [];
  return fs
    .readdirSync(root, { withFileTypes: true })
    .filter((e) => e.isDirectory() && /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,80}$/.test(e.name))
    .map((e) => ({ name: e.name, files: readSkill(path.join(root, e.name)) }))
    .filter((s) => s.files.length > 0);
}

function chats(store: Store): InstanceChat[] {
  return store.threads
    .list({ limit: null })
    .filter((t) => CHAT_KINDS.has(t.kind))
    .map((t) => ({
      id: t.id,
      kind: t.kind as InstanceChat["kind"],
      title: t.title,
      agent_ids: t.agent_ids,
      ...(t.project_id ? { project_id: t.project_id } : {}),
      created_at: t.created_at,
      messages: store.messages.list(t.id, 100_000).flatMap((m) => {
        const text = m.parts
          .flatMap((p) => (p.type === "text" ? [p.text] : []))
          .join("\n\n")
          .trim();
        return text ? [{ author: m.author, text, created_at: m.created_at }] : [];
      }),
    }))
    .filter((c) => c.messages.length > 0);
}

export class InstanceTooBig extends Error {}

export function exportInstance(deps: InstanceDeps, o: { chats: boolean; rows: boolean }) {
  const { store } = deps;
  const settings: Record<string, unknown> = {};
  for (const k of MOVED_SETTINGS) if (store.settings.get(k) !== undefined) settings[k] = store.settings.read(k);
  for (const k of MOVED_TEXT_SETTINGS) {
    const v = store.settings.get(k);
    if (v !== undefined) settings[k] = v;
  }
  const raw: InstanceFile = {
    format: INSTANCE_FORMAT,
    version: INSTANCE_VERSION,
    apx_version: deps.version,
    created_at: (deps.now?.() ?? new Date()).toISOString(),
    includes: { chats: o.chats, rows: o.rows },
    agents: store.agents
      .list()
      .filter((a) => a.source === "local")
      .map(agentShape),
    projects: store.projects.list().map((p) => projectShape(p, deps.userHome)),
    routines: store.routines.list().map(routineShape),
    tables: store.flowTables
      .list()
      .flatMap((t) => tableShape(store, t.project, t.name, o.rows) ?? [])
      .reverse(),
    flows: store.flows.list().flatMap((f) => flowShape(store, f.id, o.rows) ?? []),
    memory: store.memories.standing(200_000).map(memoryShape),
    channels: store.settings.read("channels").map((c) => InstanceChannel.parse(c)),
    mcps: ownMcps(store).map(mcpShape),
    providers: store.settings.read("providers").map(providerShape),
    settings,
    skills: skills(deps.home),
    chats: o.chats ? chats(store) : [],
  };
  const known = knownSecrets(deps.secrets);
  const file = scrubbed(raw, known);
  const text = JSON.stringify(file);
  if (carriesSecret(text, known)) throw new Error("The export still held a secret value and was not made");
  const bytes = Buffer.byteLength(text);
  if (bytes > INSTANCE_MAX_BYTES) throw new InstanceTooBig("The export is too big");
  const day = file.created_at.slice(0, 10);
  return { file, name: `apx-export-${day}.json`, bytes };
}
