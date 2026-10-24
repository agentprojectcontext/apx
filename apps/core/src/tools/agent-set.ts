// agent_set: the super-agent runs the team for the owner (create, rename, rewrite a prompt, archive), each change once
// the owner says yes. Autonomy and models stay the owner's own (DECISIONS.md#d-060).
import { type Organization, randomAgentName } from "@apx/protocol";
import { z } from "zod";
import type { AgentRecord } from "../domain/agents.ts";
import type { Store } from "../domain/store.ts";
import { defineTool, type Tool } from "./types.ts";

/** Tools only the super-agent is offered (see policy.ts). */
export const SUPER_AGENT_TOOLS: ReadonlySet<string> = new Set(["agent_set", "apx_settings"]);

const Slug = z
  .string()
  .regex(/^[a-z][a-z0-9_-]*$/)
  .max(64);

function card(store: Store, a: AgentRecord): string {
  const project = a.project_id ? (store.projects.get(a.project_id)?.name ?? a.project_id) : "";
  return [
    `${a.name} (id: ${a.id}${a.slug && a.slug !== a.id ? `, slug: ${a.slug}` : ""})${project ? ` [${project}]` : ""}`,
    a.role ? `role: ${a.role}` : "",
    a.area ? `area: ${a.area}` : "",
    a.orchestrator ? "orchestrator: yes" : "",
    a.parent ? `reports to: ${a.parent}` : "",
    a.description ? `description: ${a.description}` : "",
    a.personality ? `personality: ${a.personality}` : "",
    "prompt:",
    a.prompt || "(empty)",
  ]
    .filter(Boolean)
    .join("\n");
}

/** A registered project by id or by its name (any case); a name two projects share is an error, never a guess. */
function projectOf(store: Store, ref: string): { id: string; name: string } | string {
  const list = store.projects.list();
  const hits = list.filter((p) => p.id === ref);
  const named = hits.length ? hits : list.filter((p) => p.name.toLowerCase() === ref.toLowerCase());
  if (named.length === 1 && named[0]) return named[0];
  if (named.length > 1) return `"${ref}" matches ${named.map((p) => p.id).join(", ")}; use the id`;
  return `unknown project "${ref}"; run \`apx projects\` for the ids`;
}

const slugOf = (name: string) =>
  name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);

const kindOf = (store: Store, projectId: string | undefined) =>
  projectId ? store.projects.get(projectId)?.kind : store.settings.read("base_project").kind;

/** What the super-agent picks from before it creates or changes an agent: the project's kind, areas, roles, team. */
function teamSheet(store: Store, projectId: string | undefined, org: Organization): string {
  const kind = kindOf(store, projectId);
  const company = kind === "company";
  const team = store.agents.list().filter((a) => a.kind === "agent" && a.project_id === projectId);
  return [
    `project kind: ${kind ?? "not set"}${company ? "" : " (areas only exist in company projects: leave area out)"}`,
    company ? `areas: ${org.areas.map((x) => `${x.name} (${x.slug})`).join(", ") || "none yet"}` : "",
    `roles: ${
      [...new Set([...org.roles.map((r) => r.name), ...team.map((a) => a.role).filter(Boolean)])].join("; ") ||
      "none yet"
    }`,
    "team:",
    ...team.map(
      (a) =>
        `- ${a.name} (${a.slug ?? a.id})${a.role ? `: ${a.role}` : ""}${a.area ? ` [${a.area}]` : ""}${a.orchestrator ? " — orchestrator" : ""}`,
    ),
    "Pick an existing area and role when one fits; a new one is added to the project. Keep role a short title and description one or two sentences.",
  ]
    .filter(Boolean)
    .join("\n");
}

/** A role is a title shown in lists and on cards. */
const ROLE_MAX = 40;

export function agentSetTools(store: Store): Tool[] {
  const args = z.object({
    agent: z.string().trim().min(1).max(120).optional().describe("id or name; omit to create one"),
    slug: Slug.optional().describe("a new agent's id, or a project agent's new file name"),
    name: z.string().trim().min(1).max(80).optional(),
    role: z.string().trim().optional(),
    area: z.string().trim().optional(),
    orchestrator: z.boolean().optional(),
    description: z.string().max(400).optional(),
    prompt: z.string().max(100_000).optional(),
    personality: z.string().max(1000).optional(),
    parent: z.string().max(64).optional().describe("who it reports to"),
    project: z.string().optional(),
    archive: z.boolean().optional(),
  });
  type Args = z.output<typeof args>;
  const changes = (a: Args) =>
    [a.slug, a.name, a.role, a.area, a.orchestrator, a.description, a.prompt, a.personality, a.parent].some(
      (v) => v !== undefined,
    ) || a.archive === true;
  return [
    defineTool({
      name: "agent_set",
      description:
        "Run the team: no args: team, areas, roles; only agent: read it; create one (slug, role; name only if the owner chose one; project: id/name, default this chat), change one (only what you give; a prompt replaces the old) or archive it.",
      args,
      effect: "local",
      confirm: (a) => (changes(a) ? "always" : "never"),
      ownerSetting: changes,
      deadlineMs: 15_000,
      title: (a) =>
        !a.agent
          ? `Created the agent ${a.name ?? a.slug ?? ""}`
          : `${a.archive ? "Archived" : changes(a as Args) ? "Changed" : "Looked at"} ${a.agent}`,
      // Before the owner is asked: a sentence as the role fills the team's role list and every agent card.
      check(a) {
        if (a.role && a.role.length > ROLE_MAX)
          throw new Error(
            `role is a short title of a few words (like "Issue triage"), at most ${ROLE_MAX} characters: put the longer text in description`,
          );
      },
      async run(a, ctx) {
        let cur: AgentRecord | undefined;
        if (!a.agent && !changes(a)) {
          const target = a.project ? projectOf(store, a.project) : undefined;
          if (typeof target === "string") return target;
          const pid = target?.id ?? ctx.thread.project_id;
          return teamSheet(store, pid, await ctx.call("org.get", pid ? { project: pid } : {}));
        }
        if (a.agent) {
          const found = store.agents.resolve(a.agent, ctx.thread.project_id);
          if ("error" in found) return found.error;
          cur = found.agent;
        }
        if (cur && a.project)
          return `${cur.name} stays in its project; to copy it into another, run \`apx agents clone ${cur.id} --project <project-id>\``;
        if (cur && !changes(a)) return card(store, cur);
        if (!ctx.callAsOwner) return "not run: the owner did not approve it";
        const asOwner = ctx.callAsOwner;
        // Where the agent lives decides whether it can have an area, and which areas and roles are there to pick.
        let pid = cur?.project_id ?? ctx.thread.project_id;
        if (!cur && a.project) {
          const p = projectOf(store, a.project);
          if (typeof p === "string") return p;
          pid = p.id;
        }
        let area: string | undefined;
        if (a.area !== undefined || a.role) {
          const company = kindOf(store, pid) === "company";
          if (a.area && !company) return "not run: areas only exist in company projects; leave area out";
          if (company) {
            const org = await ctx.call("org.get", pid ? { project: pid } : {});
            const want = a.area?.toLowerCase();
            const found = want ? org.areas.find((x) => x.slug === want || x.name.toLowerCase() === want) : undefined;
            const newArea = a.area && !found ? { slug: slugOf(a.area), name: a.area } : undefined;
            area = a.area === "" ? "" : (found?.slug ?? newArea?.slug);
            const roleArea = area || cur?.area;
            const newRole =
              a.role && !org.roles.some((r) => r.name.toLowerCase() === a.role?.toLowerCase())
                ? { slug: slugOf(a.role), name: a.role, ...(roleArea ? { area: roleArea } : {}) }
                : undefined;
            // A new area or role joins the project's own lists, so the next agent can pick it.
            if (newArea || newRole)
              await asOwner("org.set", {
                ...(pid ? { project: pid } : {}),
                organization: {
                  areas: [...org.areas, ...(newArea?.slug ? [newArea] : [])],
                  roles: [...org.roles, ...(newRole?.slug ? [newRole] : [])],
                },
              });
          }
        }
        if (!cur) {
          if (!a.slug) return "a new agent needs a slug";
          const projectId = pid;
          const made = await asOwner("agents.create", {
            ...(projectId ? { project_id: projectId } : {}),
            slug: a.slug,
            // A person's name from APX's generator unless the owner gave one; the job is its role.
            name: a.name ?? randomAgentName(store.agents.list().map((x) => x.name)),
            role: a.role ?? "",
            ...(a.description ? { description: a.description } : {}),
            prompt: a.prompt ?? "",
            ...(a.parent ? { parent: a.parent } : {}),
            ...(area ? { area } : {}),
            ...(a.personality ? { personality: a.personality } : {}),
            ...(a.orchestrator ? { orchestrator: true } : {}),
          });
          // Where it landed, so the agent never tells the owner it is in a project it is not.
          const home = made.project_id ? (store.projects.get(made.project_id)?.name ?? made.project_id) : "";
          return `created: ${made.name} (id: ${made.id}) ${home ? `in the project ${home}` : "as a global agent (no project)"}`;
        }
        if (a.archive) {
          const r = await asOwner("agents.archive", { agent: cur.id });
          // What the agent tells the owner: it is gone from the team, and where to bring it back or delete it.
          return `removed ${cur.name}: it is off the team and out of every list${r.moved_to ? ` (its file is kept in ${r.moved_to})` : ""}. Tell the owner they can bring it back whenever they want, or delete it for good, in [Config › Agents](apx:settings/agents).`;
        }
        const { agent: _a, archive: _x, project: _p, area: _ar, ...fields } = a;
        const now = await asOwner("agents.update", {
          agent: cur.id,
          ...fields,
          ...(area !== undefined ? { area } : {}),
        });
        return `saved: ${now.name} (id: ${now.id}${now.slug ? `, slug: ${now.slug}` : ""})`;
      },
    }),
  ];
}
