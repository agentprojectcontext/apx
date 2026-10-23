// apx_settings, where the work happens and what it draws on: projects, memory, skills, MCP servers and extensions on
// or off, media services and widgets. A project's autonomy and read-only folders and memory's model stay the owner's
// (DECISIONS.md#d-060); so does adding an MCP server, whose command and keys run on this computer.
import { memorySettings } from "../domain/memory-settings.ts";
import { imageDefaultsOf } from "../services/registry.ts";
import { inlineName } from "./result.ts";
import { merged, ownersField, type Params, projectName, quoted, type Setting, str } from "./settings-kit.ts";

const AUTONOMY = "how far agents may act stays the owner's (DECISIONS.md#d-060)";
const MODEL = "which model runs stays the owner's (DECISIONS.md#d-060)";

const on = (v: unknown) => (v ? "on" : "off");
const noteText = (store: Parameters<typeof projectName>[0], id: unknown) => quoted(store.memories.get(str(id))?.text);
const widget = (store: Parameters<typeof projectName>[0], id: unknown) =>
  inlineName(store.surfaces.get(str(id))?.title ?? str(id));
const scopeOf = (p: Params, store: Parameters<typeof projectName>[0]) =>
  p.project ? ` in ${projectName(store, p.project)}` : "";

export const WORK: Readonly<Record<string, Setting>> = {
  "projects.list": {
    does: "the projects, their folders and settings",
    read: (_p, { store }) =>
      store.projects
        .list()
        .map((p) => {
          const bits = [p.kind ?? "", p.path ? `folder ${p.path}` : "kept by APX", p.present ? "" : "folder away"];
          return `- ${inlineName(p.name)} [${p.id}] (${bits.filter(Boolean).join(", ")})${p.description ? `: ${p.description.slice(0, 160)}` : ""}`;
        })
        .join("\n") || "no projects yet.",
  },
  "projects.create": {
    does: "create a project (name, kind, description) in a folder (path, made if missing) or kept by APX",
    named: ["name", "path"],
    says: (p) => `Create the project ${inlineName(str(p.name) || str(p.path))}${p.path ? ` in ${str(p.path)}` : ""}`,
  },
  "projects.register": {
    does: "add a folder already on disk as a project (path; init: give a plain folder AGENTS.md and .apc/)",
    named: ["path"],
    says: (p) => `Add the folder ${str(p.path)} as a project`,
  },
  "projects.unregister": {
    does: "stop listing a project (project); its files and chats stay",
    named: ["project"],
    says: (p, { store }) => `Stop listing ${projectName(store, p.project)} (its files and chats stay)`,
  },
  "projects.update": {
    does: "change a project (project, and only what changes: name, description, kind); autonomy and read-only folders stay the owner's",
    says: (p, { store }) => `Change ${projectName(store, p.project)}`,
    refuse: (p, { store }) => {
      const cur = store.projects.get(str(p.project)) as Params | undefined;
      return ownersField(p, cur, "autonomy", AUTONOMY) ?? ownersField(p, cur, "read_only_folders", AUTONOMY);
    },
    now: (p, { store }) => {
      const cur = store.projects.get(str(p.project));
      return cur && { project: cur.id, name: cur.name, description: cur.description, kind: cur.kind };
    },
  },
  "projects.update_base": {
    does: "change the base project, where chats with no project live (name, description, kind)",
    says: () => "Change the base project",
    refuse: (p, { store }) => ownersField(p, store.settings.read("base_project"), "autonomy", AUTONOMY),
    now: (_p, { store }) => store.settings.read("base_project"),
  },
  "projects.helper_set": {
    does: "a project's helper, which suggests the next step (project; enabled, goal, first_result)",
    says: (p, { store }) => `Change the helper of ${projectName(store, p.project)}`,
    now: (p, { store }) => ({ project: p.project, ...store.settings.read("project_helper")[str(p.project)] }),
  },
  "memory.settings": {
    does: "how notes are searched and how long chats are kept small",
    read: (_p, { store }) =>
      Object.entries(memorySettings(store))
        .map(([k, v]) => `${k}: ${JSON.stringify(v)}`)
        .join("\n"),
  },
  "memory.set_settings": {
    does: "change memory's settings (only what changes: mode, auto_recall, auto_capture, auto_compact…); its model stays the owner's",
    says: () => "Change how memory works",
    refuse: (p, { store }) => ownersField(p, memorySettings(store), "aux_model", MODEL),
    now: (_p, { store }) => memorySettings(store),
    keep: (p, { store }) => merged(memorySettings(store), p),
  },
  "memory.confirm": {
    does: "confirm a note an agent wrote about the owner, so every agent reads it (id)",
    named: ["id"],
    says: (p, { store }) => `Confirm the note ${noteText(store, p.id)}`,
  },
  "memory.restore": {
    does: "bring a forgotten note back (id)",
    named: ["id"],
    says: (p, { store }) => `Bring back the forgotten note ${noteText(store, p.id)}`,
  },
  "memory.undo": {
    does: "put a note back as it was at an earlier revision (id, revision)",
    named: ["id", "revision"],
    says: (p, { store }) => `Put the note ${noteText(store, p.id)} back as it was at revision ${String(p.revision)}`,
  },
  "memory.reindex": {
    does: "index every note again for search",
    says: () => "Index every note again for search",
  },
  "memory.maintenance": {
    does: "run memory's upkeep now (backfill: index what is missing; dream: tidy the notes)",
    named: ["backfill", "dream"],
    says: (p) =>
      `Run memory's upkeep now${p.backfill ? ", indexing what is missing" : ""}${p.dream ? ", tidying the notes" : ""}`,
  },
  "skills.import": {
    does: "import skills (pick) from a folder or a git repo (source) for everyone or a project (target, project)",
    named: ["source", "pick", "project"],
    says: (p, { store }) => {
      const s = (p.source ?? {}) as Params;
      const from = s.kind === "repo" ? str(s.url) : str(s.path);
      return `Import the skills ${(p.pick as string[] | undefined)?.join(", ") ?? ""} from ${from}${scopeOf(p, store)}`;
    },
    refuse: (p) =>
      (p.source as Params | undefined)?.kind === "zip"
        ? "a zip comes from the owner's computer: they import it in Settings › Skills"
        : undefined,
  },
  "skills.save": {
    does: "write a skill (name, content: its SKILL.md) for everyone or a project (target, project)",
    named: ["name", "project"],
    says: (p, { store }) => `Save the skill ${str(p.name)}${scopeOf(p, store)}`,
  },
  "skills.toggle": {
    does: "turn a skill on or off (name, on), for everyone or in a project",
    named: ["name", "on", "project"],
    says: (p, { store }) => `Turn the skill ${str(p.name)} ${on(p.on)}${scopeOf(p, store)}`,
  },
  "skills.runtimes": {
    does: "copy APX's skills into the other agent apps on this computer (Claude Code, Codex…); dry_run only lists",
    named: ["dry_run"],
    says: (p) =>
      p.dry_run
        ? "List what copying APX's skills into the other agent apps would change"
        : "Copy APX's skills into the other agent apps on this computer",
  },
  "resources.inherit": {
    does: "whether a project uses the global skills or MCP servers too (project, kind, on)",
    named: ["project", "kind", "on"],
    says: (p, { store }) =>
      `${p.on ? "Let" : "Stop"} ${projectName(store, p.project)} ${p.on ? "use" : "using"} the global ${p.kind === "mcp" ? "MCP servers" : "skills"}`,
  },
  "mcp.toggle": {
    does: "turn an MCP server on or off in a project (project, server, on)",
    named: ["project", "server", "on"],
    says: (p, { store }) => `Turn the MCP server ${str(p.server)} ${on(p.on)} in ${projectName(store, p.project)}`,
  },
  "extensions.enable": {
    does: "turn an installed extension on or off (id, enabled)",
    says: (p, { store }) =>
      `Turn the extension ${inlineName(store.extensions.get(str(p.id))?.manifest.name ?? str(p.id))} ${on(p.enabled)}`,
    now: (p, { store }) => {
      const e = store.extensions.get(str(p.id));
      return e ? { id: e.id, enabled: e.enabled } : undefined;
    },
  },
  "services.list": {
    does: "the media services (image, speech, embedding, transcription), in the order they are tried, and the image defaults",
    read: (_p, { store }) =>
      [
        ...store.settings
          .read("services")
          .map((s) => `- ${inlineName(s.label)} [${s.id}] (${s.kind}, ${s.enabled ? "on" : "off"})`),
        `image defaults: ${JSON.stringify(imageDefaultsOf(store))}`,
      ].join("\n"),
  },
  "services.order": {
    does: "the order services of one kind are tried in (kind, ids)",
    says: (p) => `Change the order ${str(p.kind)} services are tried in`,
    now: (p, { store }) => ({
      kind: p.kind,
      ids: store.settings
        .read("services")
        .filter((s) => s.kind === p.kind)
        .map((s) => s.id),
    }),
  },
  "services.defaults": {
    does: "what an image is made with unless asked otherwise (only what changes: width, height, steps…)",
    says: () => "Change the image defaults",
    now: (_p, { store }) => imageDefaultsOf(store),
    keep: (p, { store }) => merged(imageDefaultsOf(store), p),
  },
  "surfaces.copy": {
    does: "copy a widget (surface) into another project (project_id; null: the base)",
    named: ["surface", "project_id"],
    says: (p, { store }) => `Copy the widget ${widget(store, p.surface)} into ${projectName(store, p.project_id)}`,
  },
  "surfaces.import_page": {
    does: "make a widget of a project's HTML page (project_id, path)",
    named: ["project_id", "path"],
    says: (p, { store }) => `Make a widget of ${str(p.path)} in ${projectName(store, p.project_id)}`,
  },
  "surfaces.share": {
    does: "publish a widget as a page anyone with its link opens, or stop (surface, shared)",
    named: ["surface", "shared"],
    says: (p, { store }) =>
      p.shared
        ? `Publish the widget ${widget(store, p.surface)} as a page anyone with its link opens`
        : `Stop publishing the widget ${widget(store, p.surface)}`,
  },
  "surfaces.memory_clear": {
    does: "make a widget forget what it remembers (surface, parts)",
    named: ["surface", "parts"],
    says: (p, { store }) =>
      `Make the widget ${widget(store, p.surface)} forget its ${(p.parts as string[] | undefined)?.join(", ") ?? ""}`,
  },
  "surfaces.remove": {
    does: "delete a widget for good, with what it remembers (surface)",
    named: ["surface"],
    says: (p, { store }) => `Delete for good the widget ${widget(store, p.surface)} and what it remembers`,
  },
};
