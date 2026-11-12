// Reading an export back: one pass decides, item by item, whether it is added, changed, already here or left out, and
// keeps how to do it. The preview is that pass; the import is the same pass and then its steps, so what is applied is
// what was shown. See DECISIONS.md#d-192
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {
  type AgentRules,
  BASE_PROJECT_ID,
  INSTANCE_FORMAT,
  INSTANCE_MAX_BYTES,
  INSTANCE_VERSION,
  type InstanceChannel,
  InstanceFile,
  type InstancePlan,
  type InstancePlanItem,
  type InstanceReason,
  type InstanceSection,
  type Schedule,
} from "@apx/protocol";
import { FlowDraftGraph } from "@apx/protocol/flow-graph";
import { z } from "zod";
import { isApcProject, readProject } from "../apc/read.ts";
import { projectIdOf } from "../apc/sync.ts";
import { OAUTH_CHATGPT } from "../config.ts";
import { HOME_THREAD_ID } from "../domain/seed.ts";
import { SETTINGS } from "../domain/setting-keys.ts";
import { mcpConfig } from "../mcp/config.ts";
import { expandHome } from "../paths.ts";
import { NO_KEY } from "../providers/llm.ts";
import type { Secrets } from "../secrets.ts";
import { checkReadOnly } from "../tools/folders.ts";
import {
  agentShape,
  type InstanceDeps,
  MOVED_SETTINGS,
  MOVED_TEXT_SETTINGS,
  mcpShape,
  ownMcps,
  providerShape,
  readSkill,
  routineShape,
  SIGNED_IN_SETTINGS,
} from "./export.ts";
import { graphWithoutKeys, knownSecrets, mcpWithoutKeys, routineWithoutKeys, scrubbed, secretRefs } from "./scrub.ts";

export type ImportDeps = InstanceDeps & {
  secrets: Pick<Secrets, "list" | "resolve">;
  /** Registers a project folder found on this computer (apc sync). */
  register(dir: string): void;
  /** Saves a channel's configuration and starts or stops it (the channel manager). */
  setChannel(id: string, config: Omit<InstanceChannel, "id">): Promise<unknown>;
  /** One of the owner's MCP servers changed: the running one is dropped. */
  mcpChanged(name: string): void;
  /** A routine's next run, as the scheduler reckons it. */
  nextFor(schedule: Schedule): string | undefined;
};

/** Why a file is not read: not an export, another format version, or not readable as this one. */
export class InstanceRefused extends Error {
  readonly reason: "not_export" | "other_version" | "unreadable" | "too_big";
  constructor(reason: InstanceRefused["reason"], message: string) {
    super(message);
    this.reason = reason;
  }
}

function readInstanceFile(raw: unknown): InstanceFile {
  const head = z.object({ format: z.unknown(), version: z.unknown() }).safeParse(raw);
  if (!head.success || head.data.format !== INSTANCE_FORMAT)
    throw new InstanceRefused("not_export", "This file is not an APX export");
  const v = head.data.version;
  if (v !== INSTANCE_VERSION) {
    const newer = typeof v === "number" && v > INSTANCE_VERSION;
    throw new InstanceRefused(
      "other_version",
      newer
        ? `This export was made by a newer APX (format ${v}); update APX here, then import it`
        : `This export is in format ${String(v)}, which this APX does not read (it reads format ${INSTANCE_VERSION})`,
    );
  }
  if (Buffer.byteLength(JSON.stringify(raw)) > INSTANCE_MAX_BYTES)
    throw new InstanceRefused("too_big", "This export is too big to import");
  const parsed = InstanceFile.safeParse(raw);
  if (!parsed.success) {
    const where = parsed.error.issues[0]?.path.join(".") ?? "";
    throw new InstanceRefused("unreadable", `This export can't be read${where ? ` (at ${where})` : ""}`);
  }
  const f = parsed.data;
  const ids: Array<[string, string[]]> = [
    ["agents", f.agents.map((a) => a.id)],
    ["projects", f.projects.map((p) => p.id)],
    ["routines", f.routines.map((r) => r.id)],
    ["tables", f.tables.map((t) => `${t.project_id}/${t.name}`)],
    ["flows", f.flows.map((x) => x.definition.id)],
    ["channels", f.channels.map((c) => c.id)],
    ["mcps", f.mcps.map((m) => m.name)],
    ["skills", f.skills.map((x) => x.name.toLowerCase())],
    ["chats", f.chats.map((c) => (c.kind === "home" ? "home" : c.id))],
  ];
  // The same item twice would be written twice, the second failing halfway through an import.
  const twice = ids.find(([, list]) => new Set(list).size !== list.length);
  if (twice) throw new InstanceRefused("unreadable", `This export can't be read (${twice[0]} listed twice)`);
  return f;
}

type Step = () => void | Promise<void>;
type Planned = { item: InstancePlanItem; apply?: Step };

/** Equal as data, whatever the order of keys. */
const stable = (v: unknown): string =>
  JSON.stringify(v, (_k, x: unknown) =>
    x && typeof x === "object" && !Array.isArray(x)
      ? Object.fromEntries(Object.entries(x as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)))
      : x,
  );
const same = (a: unknown, b: unknown) => stable(a) === stable(b);
const without = <T extends object, K extends string>(o: T, ...keys: K[]) =>
  Object.fromEntries(Object.entries(o).filter(([k]) => !keys.includes(k as K)));
const short = (text: string) => (text.length > 80 ? `${text.slice(0, 79)}…` : text);

/** A skill file's path inside its folder, or undefined when it would reach out of it. */
const insideSkill = (p: string) =>
  !path.isAbsolute(p) && !p.includes("\\") && p.split("/").every((s) => s && s !== "." && s !== "..") ? p : undefined;

function planImport(deps: ImportDeps, raw: unknown) {
  const file = readInstanceFile(raw);
  const { store } = deps;
  const known = knownSecrets(deps.secrets);
  /** What this computer has, read as the file would carry it. */
  const mine = <T>(v: T): T => scrubbed(v, known);
  const out: Planned[] = [];
  const push = (
    section: InstanceSection,
    id: string,
    label: string,
    action: InstancePlanItem["action"],
    apply?: Step,
    o: { off?: boolean; reason?: InstanceReason } = {},
  ) =>
    out.push({
      item: { section, id, label, action, ...(o.off ? { off: true } : {}), ...(o.reason ? { reason: o.reason } : {}) },
      ...(apply && (action === "add" || action === "update") ? { apply } : {}),
    });
  const skip = (section: InstanceSection, id: string, label: string, reason: InstanceReason) =>
    push(section, id, label, "skip", undefined, { reason });

  const projects = new Set(store.projects.list().map((p) => p.id));
  const agents = new Set(store.agents.list().map((a) => a.id));
  // The super-agent of another install may have another id: it is this one's.
  const agentMap = new Map<string, string>();
  const ownSecretary = store.agents.list().find((a) => a.kind === "secretary")?.id;
  for (const a of file.agents)
    if (a.kind === "secretary" && ownSecretary && a.id !== ownSecretary) agentMap.set(a.id, ownSecretary);
  const agentOf = (id: string) => agentMap.get(id) ?? id;

  const c: Ctx = { push, skip, mine, projects, agents, agentOf };
  planProjects(deps, file, c);
  planAgents(deps, file, c);
  for (const [key, value] of Object.entries(file.settings)) planSetting(deps, key, value, c);
  planProviders(deps, file, c);
  planMcps(deps, file, c);
  planChannels(deps, file, c);
  planRoutines(deps, file, c);
  planFlows(deps, file, c);
  planMemory(deps, file, c);
  planSkills(deps, file, c);
  planChats(deps, file, c);

  const plan: InstancePlan = {
    apx_version: file.apx_version,
    created_at: file.created_at,
    includes: file.includes,
    items: out.map((p) => p.item),
    secrets: secretRefs(file).filter((name) => deps.secrets.resolve(`secret://${name}`) === undefined),
  };
  return { plan, steps: out.flatMap((p) => (p.apply ? [p.apply] : [])) };
}

type Push = (
  section: InstanceSection,
  id: string,
  label: string,
  action: InstancePlanItem["action"],
  apply?: Step,
  o?: { off?: boolean; reason?: InstanceReason },
) => void;
type Skip = (section: InstanceSection, id: string, label: string, reason: InstanceReason) => void;
type Mine = <T>(v: T) => T;
type Ctx = {
  push: Push;
  skip: Skip;
  mine: Mine;
  projects: Set<string>;
  agents: Set<string>;
  agentOf: (id: string) => string;
};

/** Acting outside or irreversibly without asking skips the owner's card like Total, so it never comes from a file. */
function rulesHere(asked: AgentRules, here: AgentRules | undefined): AgentRules | undefined {
  const rules: AgentRules = { ...asked };
  for (const risk of ["outside", "irreversible"] as const)
    if (rules[risk] === "auto") {
      if (here?.[risk]) rules[risk] = here[risk];
      else delete rules[risk];
    }
  return Object.keys(rules).length ? rules : undefined;
}

/** An agent of this computer's own files stays as its file says. */
function planAgents(deps: ImportDeps, file: InstanceFile, c: Ctx) {
  const { store } = deps;
  const { push, skip, mine, projects, agents, agentOf } = c;
  for (const a of file.agents) {
    const id = agentOf(a.id);
    if (a.project_id && !projects.has(a.project_id)) {
      skip("agents", id, a.name, "project_missing");
      continue;
    }
    const here = store.agents.get(id);
    // As for projects, Total is the owner's choice on this computer: one here keeps its own, a new one has none.
    const { autonomy: asked, rules: askedRules, ...rest } = a;
    const autonomy = asked === "total" ? here?.autonomy : asked;
    const rules = askedRules && rulesHere(askedRules, here?.rules);
    const want = { ...rest, id, ...(autonomy ? { autonomy } : {}), ...(rules ? { rules } : {}) };
    if (here?.source === "apc") {
      agents.add(id);
      skip("agents", id, a.name, "kept_here");
      continue;
    }
    const archived = here ? !agents.has(id) : false;
    agents.add(id);
    const action = !here ? "add" : !archived && same(mine(agentShape(here)), want) ? "same" : "update";
    push("agents", id, a.name, action, () => {
      store.agents.upsert(want);
      if (archived) store.agents.unarchive(id);
    });
  }
}

/** A model API arrives off when its key is not here, when it would use one that is, or when it changed. */
function planProviders(deps: ImportDeps, file: InstanceFile, c: Ctx) {
  const { store } = deps;
  const { push, skip, mine } = c;
  for (const p of file.providers) {
    const parsed = SETTINGS.providers.schema.safeParse([p]);
    const id = typeof p.id === "string" ? p.id : "";
    const label = typeof p.label === "string" && p.label ? p.label : id;
    if (!parsed.success || parsed.data.length !== 1) {
      skip("providers", id, label, "invalid");
      continue;
    }
    const want = providerShape(parsed.data[0] as Record<string, unknown>) as (typeof parsed.data)[number];
    const list = store.settings.read("providers");
    const here = list.find((x) => x.id === id);
    const keyless = want.key === NO_KEY;
    const needsKey = !keyless && want.key !== OAUTH_CHATGPT && !deps.secrets.resolve(want.key);
    const compared = (x: object) => without(x, "enabled", "key");
    const action = !here ? "add" : same(compared(mine(providerShape(here))), compared(want)) ? "same" : "update";
    push(
      "providers",
      id,
      label,
      action,
      () => {
        const rest = store.settings.read("providers").filter((x) => x.id !== id);
        // Off until the owner looks, unless it needs no key: a key here could be sent to the address the file gives.
        const next = here ? { ...want, key: here.key || want.key, enabled: false } : { ...want, enabled: keyless };
        store.settings.write("providers", [...rest, next]);
      },
      here
        ? { off: true, reason: "changed" }
        : needsKey
          ? { off: true, reason: "needs_secret" }
          : keyless
            ? {}
            : { off: true, reason: "uses_key" },
    );
  }
}

/** One of the owner's servers arrives off: its variables and sign-in are filled here; a changed one is checked again. */
function planMcps(deps: ImportDeps, file: InstanceFile, c: Ctx) {
  const { store } = deps;
  const { push, mine } = c;
  const mcp = mcpConfig(store);
  for (const m of file.mcps) {
    const here = ownMcps(store).find((d) => d.name === m.name);
    const compared = (x: object) => without(x, "enabled");
    const shaped = here && mcpWithoutKeys(mine(mcpShape(here, deps.userHome)));
    const action = !shaped ? "add" : same(compared(shaped), compared(m)) ? "same" : "update";
    const { name, enabled: _e, project, ...server } = m;
    push(
      "mcps",
      name,
      name,
      action,
      () => {
        // A value the file leaves empty keeps this computer's; a changed server is off until the owner looks.
        const keep = (file: Record<string, string>, local: Record<string, string> = {}) =>
          Object.fromEntries(Object.entries(file).map(([k, v]) => [k, v === "" ? (local[k] ?? "") : v]));
        const env = keep(server.env, here?.env);
        const headers = keep(server.headers, here?.headers);
        const command = server.command && expandHome(server.command, deps.userHome);
        const args = server.args.map((a) => expandHome(a, deps.userHome));
        mcp.setGlobal(name, {
          ...server,
          ...(command ? { command } : {}),
          args,
          env,
          headers,
          ...(project ? { project } : {}),
          enabled: false,
        });
        deps.mcpChanged(name);
      },
      { off: true, reason: here ? "changed" : "needs_secret" },
    );
  }
}

/** A channel arrives off: its token or link is this computer's to give; a changed one is checked again. */
function planChannels(deps: ImportDeps, file: InstanceFile, c: Ctx) {
  const { store } = deps;
  const { push, skip, mine, agents, agentOf } = c;
  for (const ch of file.channels) {
    const want = {
      ...ch,
      agent_id: agentOf(ch.agent_id),
      ...(ch.contacts_agent_id ? { contacts_agent_id: agentOf(ch.contacts_agent_id) } : {}),
    };
    if (!agents.has(want.agent_id) || (want.contacts_agent_id && !agents.has(want.contacts_agent_id))) {
      skip("channels", ch.id, ch.label, "agent_missing");
      continue;
    }
    const here = store.settings.read("channels").find((x) => x.id === ch.id);
    const compared = (x: object) => without(x, "enabled");
    const action = !here ? "add" : same(compared(mine(here)), compared(want)) ? "same" : "update";
    const { id, ...config } = want;
    push(
      "channels",
      id,
      ch.label,
      action,
      // Changed, it could answer other people or as another agent: off until the owner looks.
      async () => {
        await deps.setChannel(id, { ...config, enabled: false });
      },
      { off: true, reason: here ? "changed" : "needs_secret" },
    );
  }
}

/** A new routine keeps its switch unless it runs a command; a changed one is off until the owner looks. */
function planRoutines(deps: ImportDeps, file: InstanceFile, c: Ctx) {
  const { store } = deps;
  const { push, skip, mine, projects, agents, agentOf } = c;
  for (const r of file.routines) {
    const want = { ...r, agent_id: agentOf(r.agent_id) };
    if (r.project_id && !projects.has(r.project_id)) {
      skip("routines", r.id, r.name, "project_missing");
      continue;
    }
    if (!agents.has(want.agent_id)) {
      skip("routines", r.id, r.name, "agent_missing");
      continue;
    }
    const here = store.routines.get(r.id);
    const compared = (x: object) => without(x, "enabled");
    const shaped = here && routineWithoutKeys(mine(routineShape(here)));
    const action = !shaped ? "add" : same(compared(shaped), compared(want)) ? "same" : "update";
    // A command runs on this computer: a routine with one, or one whose work changed, waits for the owner.
    const commands = Boolean(want.pre_command || want.post_command || want.action === "shell");
    // So does one that would act on Total here: how freely it acts is this owner's choice (DECISIONS.md#d-223).
    const wait = commands || Boolean(here) || want.autonomy === "total";
    push(
      "routines",
      r.id,
      r.name,
      action,
      () => {
        const enabled = wait ? false : want.enabled;
        const next = enabled ? deps.nextFor(want.schedule) : undefined;
        const { id, enabled: _e, ...rest } = want;
        const draft = {
          ...rest,
          enabled: enabled && (next !== undefined || want.schedule.kind !== "once"),
          next_run_at: next,
        };
        if (here) store.routines.update(id, draft);
        else store.routines.create(draft, id);
      },
      wait && (here?.enabled || want.enabled) ? { off: true, reason: commands ? "runs_command" : "changed" } : {},
    );
  }
}

/**
 * A project is APX's settings about a folder: found here, the folder is registered and its own files say the rest;
 * not found, the project waits for its folder (registered later, it is the same project).
 */
function planProjects(deps: ImportDeps, file: InstanceFile, c: Ctx) {
  const { store, userHome } = deps;
  const isDir = (p: string) => fs.existsSync(p) && fs.statSync(p).isDirectory();
  // A subproject keeps its project when that one comes in the same copy (or is the base project); one level only.
  const tops = new Set(file.projects.filter((p) => !p.parent).map((p) => p.id));
  const parentOk = (parent: string | undefined) =>
    parent && (parent === BASE_PROJECT_ID || tops.has(parent)) ? parent : undefined;
  for (const p of file.projects) {
    const dir = p.path ? expandHome(p.path, userHome) : undefined;
    // Each folder passes the check the owner's own setting does (not APX's home, not the temp folders, not the
    // project's own); one that is not here or is refused is left out.
    const here = store.projects.get(p.id);
    const folders = (p.read_only_folders ?? []).flatMap((f) => {
      try {
        return checkReadOnly(deps.home, { path: here?.path ?? dir }, [expandHome(f, userHome)]);
      } catch {
        return [];
      }
    });
    // Total lets its agents act without asking: the owner chooses it on this computer, a copy never brings it.
    const settle = (id: string) => {
      store.projects.setAutonomy(id, p.autonomy === "total" ? undefined : p.autonomy);
      store.projects.setReadOnlyFolders(id, folders);
      if (parentOk(p.parent)) store.projects.setParent(id, p.parent);
    };
    // One this computer has keeps how far its agents go and what they read here.
    if (here && here.registered !== false) {
      c.projects.add(p.id);
      const kept = same(
        { autonomy: here.autonomy, folders: here.read_only_folders ?? [] },
        { autonomy: p.autonomy, folders },
      );
      if (kept) c.push("projects", p.id, p.name, "same");
      else c.skip("projects", p.id, p.name, "kept_here");
      continue;
    }
    c.projects.add(p.id);
    const found = dir && isDir(dir) && isApcProject(dir) ? dir : undefined;
    // A folder that holds another project is not this one's.
    if (found && projectIdOf(readProject(found).id) === p.id) {
      c.push("projects", p.id, p.name, "add", () => {
        deps.register(found);
        settle(p.id);
      });
      continue;
    }
    c.push(
      "projects",
      p.id,
      p.name,
      "add",
      () => {
        store.projects.upsert({
          id: p.id,
          name: p.name,
          ...(dir && !fs.existsSync(dir) ? { path: dir } : {}),
          ...(p.description ? { description: p.description } : {}),
          ...(p.kind ? { kind: p.kind } : {}),
          present: false,
        });
        settle(p.id);
      },
      { reason: "folder_missing" },
    );
  }
}

function planSetting(deps: ImportDeps, key: string, value: unknown, c: Ctx) {
  const { settings } = deps.store;
  if ((MOVED_TEXT_SETTINGS as readonly string[]).includes(key)) {
    if (typeof value !== "string") return c.skip("settings", key, key, "invalid");
    const here = settings.get(key);
    if (here === undefined) return c.push("settings", key, key, "add", () => settings.set(key, value));
    return here === value ? c.push("settings", key, key, "same") : c.skip("settings", key, key, "kept_here");
  }
  const k = (MOVED_SETTINGS as readonly string[]).includes(key) ? (key as (typeof MOVED_SETTINGS)[number]) : undefined;
  const parsed = k ? SETTINGS[k].schema.safeParse(value) : undefined;
  if (!k || !parsed?.success) return c.skip("settings", key, key, "invalid");
  const signedIn = SIGNED_IN_SETTINGS.has(k);
  const want = signedIn ? { ...(parsed.data as object), enabled: false } : parsed.data;
  if (settings.get(k) === undefined)
    return c.push(
      "settings",
      k,
      k,
      "add",
      () => settings.write(k, want as never),
      signedIn ? { off: true, reason: "needs_secret" } : {},
    );
  const compared = (x: unknown) => (signedIn ? without(x as object, "enabled") : x);
  return same(compared(c.mine(settings.read(k))), compared(parsed.data))
    ? c.push("settings", k, k, "same")
    : c.skip("settings", k, k, "kept_here");
}

/**
 * Tables first (a Flow writes to them), then Flows: a Flow arrives off with its drawing as a draft, since publishing
 * is where the owner confirms what it sends and calls (DECISIONS.md#d-169).
 */
function planFlows(deps: ImportDeps, file: InstanceFile, c: Ctx) {
  const { store } = deps;
  for (const t of file.tables) {
    const id = `${t.project_id}/${t.name}`;
    if (!c.projects.has(t.project_id)) {
      c.skip("tables", id, t.name, "project_missing");
      continue;
    }
    const here = store.flowTables.get(t.project_id, t.name);
    const have = here
      ? c.mine(
          store.flowTables.read(
            t.project_id,
            t.name,
            (t.rows ?? []).map((r) => r.key),
          ),
        )
      : {};
    const rows = (t.rows ?? []).filter((r) => !(r.key in have) || !same(have[r.key], r.value));
    const columns = t.columns.filter((col) => !here?.columns.includes(col));
    const required = t.required.filter((col) => !here?.required.includes(col));
    const action = !here ? "add" : rows.length || columns.length || required.length ? "update" : "same";
    c.push("tables", id, t.name, action, () => {
      if (here) for (const col of columns) store.flowTables.addColumn(t.project_id, t.name, col);
      else store.flowTables.create(t.project_id, t.name, t.columns);
      for (const r of rows) store.flowTables.write(t.project_id, t.name, r.key, r.value);
      for (const col of required) store.flowTables.requireColumn(t.project_id, t.name, col, true);
    });
  }
  for (const f of file.flows) {
    const def = f.definition;
    if (!c.projects.has(def.projectId)) {
      c.skip("flows", def.id, def.name, "project_missing");
      continue;
    }
    const action = def.action.kind === "agent" ? { ...def.action, agent: c.agentOf(def.action.agent) } : def.action;
    const graph = f.graph ? FlowDraftGraph.parse(f.graph) : null;
    const here = store.flows.get(def.id);
    const have = here
      ? c.mine(
          store.flows.readRows(
            def.id,
            (f.rows ?? []).map((r) => r.key),
          ),
        )
      : {};
    const rows = (f.rows ?? []).filter((r) => !(r.key in have) || !same(have[r.key], r.value));
    const writeRows = () => {
      for (const r of rows) store.flows.write(def.id, r.key, r.value);
    };
    if (!here) {
      const taken = def.path && store.flows.byPath(def.path);
      const { path: _p, ...rest } = def;
      c.push(
        "flows",
        def.id,
        def.name,
        "add",
        () =>
          store.tx(() => {
            store.flows.save({ ...rest, action, enabled: false, ...(def.path && !taken ? { path: def.path } : {}) });
            if (graph) store.flowGraphs.saveDraft(def.id, null, graph);
            writeRows();
          }),
        { off: true, reason: "draft" },
      );
      continue;
    }
    const doc = store.flowGraphs.get(def.id);
    const kept = [doc.published, doc.draft].flatMap((g) => {
      const r = g ? FlowDraftGraph.safeParse(c.mine(g)) : undefined;
      return r?.success ? [graphWithoutKeys(r.data, def.name)] : [];
    });
    const newGraph = graph !== null && !kept.some((g) => same(g, graph));
    const renamed = here.name !== def.name;
    c.push(
      "flows",
      def.id,
      def.name,
      newGraph || renamed || rows.length ? "update" : "same",
      () =>
        store.tx(() => {
          if (renamed) store.flows.save({ ...here, name: def.name });
          if (newGraph && graph) store.flowGraphs.saveDraft(def.id, store.flowGraphs.get(def.id).draftVersion, graph);
          writeRows();
        }),
      newGraph ? { reason: "draft" } : {},
    );
  }
}

function planMemory(deps: ImportDeps, file: InstanceFile, c: Ctx) {
  const { store } = deps;
  for (const m of file.memory) {
    const want = { ...m, ...(m.agent_id ? { agent_id: c.agentOf(m.agent_id) } : {}) };
    const id = createHash("sha256")
      .update(JSON.stringify([want.scope, want.project_id ?? "", want.agent_id ?? "", want.text]))
      .digest("hex")
      .slice(0, 16);
    const label = short(m.text);
    if (want.project_id && !c.projects.has(want.project_id)) c.skip("memory", id, label, "project_missing");
    else if (want.agent_id && !c.agents.has(want.agent_id)) c.skip("memory", id, label, "agent_missing");
    else c.push("memory", id, label, store.memories.find(want) ? "same" : "add", () => void store.memories.add(want));
  }
}

/** One of the owner's skills: a new one is written; one this computer has with other files stays as it is. */
function planSkills(deps: ImportDeps, file: InstanceFile, c: Ctx) {
  for (const s of file.skills) {
    const dir = path.join(deps.home, "skills", s.name);
    const files = s.files.flatMap((f) => {
      const p = insideSkill(f.path);
      return p ? [{ path: p, text: f.text }] : [];
    });
    // The same path twice (case aside, as some disks read it) or a file where another needs a folder: not one folder.
    const folded = files.map((f) => f.path.toLowerCase());
    const folders = new Set(
      folded.flatMap((p) =>
        p
          .split("/")
          .slice(0, -1)
          .map((_s, i, parts) => parts.slice(0, i + 1).join("/")),
      ),
    );
    const clash = new Set(folded).size !== folded.length || folded.some((p) => folders.has(p));
    if (files.length !== s.files.length || clash) {
      c.skip("skills", s.name, s.name, "invalid");
      continue;
    }
    if (fs.existsSync(dir)) {
      if (same(c.mine(readSkill(dir)), files)) c.push("skills", s.name, s.name, "same");
      else c.skip("skills", s.name, s.name, "kept_here");
      continue;
    }
    // Written in a hidden folder beside it (never read as a skill, never one of the owner's) and renamed whole: a
    // stopped import never leaves half a skill that reads as the owner's.
    c.push("skills", s.name, s.name, "add", () => {
      fs.mkdirSync(path.dirname(dir), { recursive: true });
      const tmp = fs.mkdtempSync(path.join(path.dirname(dir), ".importing-"));
      try {
        for (const f of files) {
          const at = path.join(tmp, ...f.path.split("/"));
          fs.mkdirSync(path.dirname(at), { recursive: true });
          fs.writeFileSync(at, f.text);
        }
        fs.renameSync(tmp, dir);
      } catch (err) {
        fs.rmSync(tmp, { recursive: true, force: true });
        throw err;
      }
    });
  }
}

function planChats(deps: ImportDeps, file: InstanceFile, c: Ctx) {
  const { store } = deps;
  for (const chat of file.chats) {
    const agentIds = [...new Set(chat.agent_ids.map(c.agentOf))].filter((id) => c.agents.has(id));
    const messages = chat.messages.map((m) => ({
      ...m,
      author: m.author.kind === "agent" ? { ...m.author, id: c.agentOf(m.author.id) } : m.author,
    }));
    const add = (threadId: string) => {
      for (const m of messages)
        store.messages.add({
          thread_id: threadId,
          author: m.author,
          parts: [{ type: "text", text: m.text }],
          at: m.created_at,
          quiet: true,
        });
      const last = messages.at(-1);
      if (last) store.threads.settle(threadId, last.created_at, short(last.text));
    };
    if (chat.kind === "home") {
      const have = store.messages.list(HOME_THREAD_ID, 100_000).flatMap((m) => {
        const text = m.parts
          .flatMap((p) => (p.type === "text" ? [p.text] : []))
          .join("\n\n")
          .trim();
        return text ? [{ author: m.author, text, created_at: m.created_at }] : [];
      });
      if (same(c.mine(have), messages)) c.push("chats", HOME_THREAD_ID, chat.title, "same");
      else if (have.length || !store.threads.get(HOME_THREAD_ID))
        c.skip("chats", HOME_THREAD_ID, chat.title, "home_not_empty");
      else c.push("chats", HOME_THREAD_ID, chat.title, "update", () => add(HOME_THREAD_ID));
      continue;
    }
    if (store.threads.get(chat.id)) c.push("chats", chat.id, chat.title, "same");
    else if (chat.project_id && !c.projects.has(chat.project_id))
      c.skip("chats", chat.id, chat.title, "project_missing");
    else if (!agentIds.length) c.skip("chats", chat.id, chat.title, "agent_missing");
    else
      c.push("chats", chat.id, chat.title, "add", () => {
        store.threads.create({
          id: chat.id,
          kind: chat.kind,
          title: chat.title,
          agent_ids: agentIds,
          ...(chat.project_id ? { project_id: chat.project_id } : {}),
          at: chat.created_at,
        });
        add(chat.id);
      });
  }
}

/** The preview: what would change, and nothing changed. */
export const previewImport = (deps: ImportDeps, raw: unknown): InstancePlan => planImport(deps, raw).plan;

/** The import stopped at its deadline: what it wrote stays whole, and importing the file again finishes it. */
export class ImportOutOfTime extends Error {}

/** How long an import may take on the server; the client waits longer (rule 9). */
const IMPORT_MS = 90_000;

/** The import: the preview's own steps, in its order. Each item is written whole; a second run finds them here. */
export async function applyImport(deps: ImportDeps, raw: unknown, signal = AbortSignal.timeout(IMPORT_MS)) {
  const { plan, steps } = planImport(deps, raw);
  const late = () => new ImportOutOfTime("The import ran out of time: import the file again to finish it");
  for (const step of steps) {
    if (signal.aborted) throw late();
    const running = step();
    if (!(running instanceof Promise)) continue;
    await new Promise<void>((resolve, reject) => {
      const stop = () => reject(late());
      if (signal.aborted) return stop();
      signal.addEventListener("abort", stop, { once: true });
      running.then(resolve, reject).finally(() => signal.removeEventListener("abort", stop));
    });
  }
  return { ...plan, applied: steps.length };
}
