// Team screen: agent templates and installing them into a project. Templates are read on each call (they are a
// handful of small files) so a folder edited by hand shows up without a restart.

import type { Routine, Schedule } from "@apx/protocol";
import type { ApcSync } from "../apc/sync.ts";
import { readTemplates, singlesOf, type TemplateFile, type TemplateRoot } from "../apc/templates.ts";
import { writeAgentFromTemplate } from "../apc/write.ts";
import { publicAgent } from "../domain/agents.ts";
import type { Store } from "../domain/store.ts";
import { badRequest, errorMessage, notFound } from "../errors.ts";
import type { Handlers } from "./router.ts";

export function teamHandlers(
  store: Store,
  apc: ApcSync,
  roots: TemplateRoot[],
  nextFor: (s: Schedule) => string | undefined,
) {
  return {
    "agents.templates": () => {
      const { teams, files } = readTemplates(roots);
      return { teams, singles: singlesOf(files) };
    },

    "agents.install": ({ project_id, templates, hang_under }) => {
      const project = store.projects.get(project_id);
      if (!project?.path) throw notFound(`project ${project_id}`);
      if (!project.present) throw badRequest(`the folder of project ${project.name} is not on disk right now`);
      const root = project.path;
      const team = store.agents.list().filter((a) => a.project_id === project_id);
      const taken = new Set(team.flatMap((a) => (a.slug ? [a.slug] : [])));
      if (hang_under && !taken.has(hang_under)) throw badRequest(`${hang_under} is not an agent of this project`);

      const { files } = readTemplates(roots);
      const skipped: Array<{ template: string; reason: string }> = [];
      const toWrite: TemplateFile[] = [];
      for (const id of templates) {
        const file = files.find((f) => f.id === id);
        if (!file) skipped.push({ template: id, reason: "no such template" });
        else if (taken.has(file.slug) || toWrite.some((w) => w.slug === file.slug))
          skipped.push({ template: id, reason: `the project already has ${file.slug}` });
        else toWrite.push(file);
      }
      // A team keeps its own shape only among what is written now; a member whose parent is not written (skipped,
      // or never picked) hangs under `hang_under`, never under an unrelated agent that happens to share the slug.
      const written: string[] = [];
      const coming = new Set(toWrite.map((f) => f.slug));
      for (const file of toWrite) {
        const parent = file.parent && coming.has(file.parent) ? file.parent : (hang_under ?? "");
        try {
          writeAgentFromTemplate(root, file.slug, file.text, parent);
          written.push(file.slug);
        } catch (err) {
          skipped.push({ template: file.id, reason: errorMessage(err) });
        }
      }
      if (written.length) apc.sync(project_id);
      const installed = written.flatMap((slug) => {
        const a = store.agents.forFile(project_id, slug, []);
        return a ? [publicAgent(a)] : [];
      });
      // Only agents written now bring their routines, so installing again never doubles them.
      const routines: Routine[] = [];
      for (const a of installed)
        for (const r of toWrite.find((f) => f.slug === a.slug)?.routineSpecs ?? [])
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
      return { installed, routines, skipped };
    },
  } satisfies Partial<Handlers>;
}
