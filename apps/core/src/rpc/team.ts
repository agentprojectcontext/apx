// Team screen: agent templates and installing them into a project, and how far agents go on their own. Templates
// are read on each call (they are a handful of small files) so a folder edited by hand shows up without a restart.

import type { Organization, Routine, Schedule } from "@apx/protocol";
import { parseFrontmatter, textField } from "../apc/frontmatter.ts";
import { readOrganization, writeOrganization } from "../apc/org.ts";
import type { ApcSync } from "../apc/sync.ts";
import { readTemplates, singlesOf, type TemplateFile, type TemplateRoot } from "../apc/templates.ts";
import { writeAgentFromTemplate, writeProjectMeta } from "../apc/write.ts";
import { publicAgent } from "../domain/agents.ts";
import type { Store } from "../domain/store.ts";
import {
  MAX_UNATTENDED_RUNS,
  MAX_UNATTENDED_TOKENS,
  saveUnattendedLimits,
  unattendedLimits,
} from "../engine/limits.ts";
import { badRequest, errorMessage, notFound } from "../errors.ts";
import { freeName } from "./agent-clone.ts";
import type { Handlers } from "./router.ts";

export function teamHandlers(
  store: Store,
  apc: ApcSync,
  roots: TemplateRoot[],
  nextFor: (s: Schedule) => string | undefined,
) {
  return {
    "agents.limits": () => ({
      ...unattendedLimits(store),
      defaults: { runs: MAX_UNATTENDED_RUNS, tokens: MAX_UNATTENDED_TOKENS },
      agents: store.settings.read("agent_limits").agents ?? {},
      fan_out_ask: store.settings.read("fan_out_ask"),
    }),
    "agents.set_fan_out_ask": ({ ask }) => {
      store.settings.write("fan_out_ask", ask);
      return { ask: store.settings.read("fan_out_ask") };
    },
    "agents.set_limits": (limits) => {
      saveUnattendedLimits(store, limits);
      return unattendedLimits(store);
    },
    "agents.set_agent_limits": ({ agent, limits }) => {
      if (!store.agents.get(agent)) throw notFound(`agent ${agent}`);
      const current = store.settings.read("agent_limits");
      const others = Object.fromEntries(Object.entries(current.agents ?? {}).filter(([id]) => id !== agent));
      const agents = limits && (limits.runs || limits.tokens) ? { ...others, [agent]: limits } : others;
      store.settings.write("agent_limits", { ...current, agents });
      return { agents };
    },

    "agents.templates": () => {
      const { teams, files } = readTemplates(roots);
      return { teams, singles: singlesOf(files) };
    },

    "agents.install": ({ project_id, templates, hang_under }) => {
      // No project: the base project, whose agents are global (kept by APX, named by their slug as id).
      const project = project_id ? store.projects.get(project_id) : undefined;
      if (project_id && !project?.path) throw notFound(`project ${project_id}`);
      if (project && !project.present)
        throw badRequest(`the folder of project ${project.name} is not on disk right now`);
      const root = project?.path;
      const team = store.agents.list().filter((a) => a.project_id === project_id);
      const taken = new Set(team.flatMap((a) => (a.slug ? [a.slug] : root ? [] : [a.id])));
      if (hang_under && !taken.has(hang_under)) throw badRequest(`${hang_under} is not an agent of this project`);

      const { files } = readTemplates(roots);
      const skipped: Array<{ template: string; reason: string }> = [];
      const toWrite: TemplateFile[] = [];
      for (const id of templates) {
        const file = files.find((f) => f.id === id);
        if (!file) skipped.push({ template: id, reason: "no such template" });
        else if (taken.has(file.slug) || toWrite.some((w) => w.slug === file.slug))
          skipped.push({ template: id, reason: `the project already has ${file.slug}` });
        // A global agent's id is its slug: one an agent of any project already uses is not free.
        else if (!root && store.agents.get(file.slug))
          skipped.push({ template: id, reason: `an agent with id ${file.slug} exists` });
        else toWrite.push(file);
      }
      // A team keeps its own shape only among what is written now; a member whose parent is not written (skipped,
      // or never picked) hangs under `hang_under`, never under an unrelated agent that happens to share the slug.
      const written: TemplateFile[] = [];
      const coming = new Set(toWrite.map((f) => f.slug));
      const used = new Set(store.agents.list().map((a) => a.name.toLowerCase()));
      for (const file of toWrite) {
        const parent = file.parent && coming.has(file.parent) ? file.parent : (hang_under ?? "");
        // APX's own templates are named by their job ("Senior Developer"): each member gets a person's name and
        // the job becomes its role. The owner's v1 agents already have names and keep them.
        const named = file.source === "apx" ? { name: freeName(used, file.name), role: file.name } : {};
        if (named.name) used.add(named.name.toLowerCase());
        try {
          if (root) writeAgentFromTemplate(root, file.slug, file.text, { parent, ...named });
          else writeGlobalAgent(store, { ...file, ...named }, parent);
          written.push(file);
        } catch (err) {
          skipped.push({ template: file.id, reason: errorMessage(err) });
        }
      }
      if (written.length && project_id) apc.sync(project_id);
      const installed = written.flatMap((f) => {
        const a = project_id ? store.agents.forFile(project_id, f.slug, []) : store.agents.get(f.slug);
        return a ? [publicAgent(a)] : [];
      });
      // Only agents written now bring their routines, so installing again never doubles them.
      const routines: Routine[] = [];
      for (const a of installed)
        for (const r of toWrite.find((f) => f.slug === (a.slug ?? a.id))?.routineSpecs ?? [])
          routines.push(
            store.routines.create({
              name: r.name,
              agent_id: a.id,
              project_id,
              schedule: r.schedule,
              action: r.action,
              prompt: r.prompt,
              call_model: "always",
              enabled: true,
              next_run_at: nextFor(r.schedule),
            }),
          );
      const kind = written.find((f) => f.teamKind)?.teamKind;
      if (!kind) return { installed, routines, skipped };
      // A team with a kind sets the project up as one: its kind, then its members' areas and roles.
      try {
        if (root) {
          writeProjectMeta(root, { kind });
          apc.sync(project_id);
        } else store.settings.write("base_project", { ...store.settings.read("base_project"), kind });
        const org = withMembers(root ? readOrganization(root) : store.settings.read("base_org"), written);
        if (root) writeOrganization(root, org);
        else store.settings.write("base_org", org);
        return { installed, routines, skipped, project_kind: kind, organization: org };
      } catch (err) {
        skipped.push({ template: "kind", reason: `the project could not be made a ${kind}: ${errorMessage(err)}` });
        return { installed, routines, skipped };
      }
    },
  } satisfies Partial<Handlers>;
}

/** A template written as a global agent (the base project has no folder for its file). */
function writeGlobalAgent(store: Store, file: TemplateFile, parent: string): void {
  const { fields, body } = parseFrontmatter(file.text);
  const icon = textField(fields.icon);
  store.agents.upsert({
    id: file.slug,
    name: file.name,
    role: file.role,
    kind: "agent",
    browser_profile: "shared",
    prompt: body,
    ...(file.description ? { description: file.description } : {}),
    ...(file.area ? { area: file.area } : {}),
    ...(parent ? { parent } : {}),
    ...(icon && /^[a-z]{2,20}$/.test(icon) ? { blob: icon } : {}),
  });
}

/** The project's areas and roles plus those of the members just installed (an area each, a role per member). */
function withMembers(org: Organization, members: TemplateFile[]): Organization {
  const areas = [...org.areas];
  const roles = [...org.roles];
  for (const m of members) {
    if (m.area && !areas.some((a) => a.slug === m.area))
      areas.push({ slug: m.area, name: m.area.charAt(0).toUpperCase() + m.area.slice(1).replace(/-/g, " ") });
    if (!roles.some((r) => r.slug === m.slug))
      roles.push({
        slug: m.slug,
        name: m.name,
        ...(m.area ? { area: m.area } : {}),
        ...(m.description ? { description: m.description.slice(0, 500) } : {}),
      });
  }
  return { areas: areas.slice(0, 40), roles: roles.slice(0, 200) };
}
