// Team screen: agent templates and installing them into a project. Templates are read on each call (they are a
// handful of small files) so a folder edited by hand shows up without a restart.

import type { ApcSync } from "../apc/sync.ts";
import { readTemplates, singlesOf, type TemplateRoot } from "../apc/templates.ts";
import { writeAgentFromTemplate } from "../apc/write.ts";
import { publicAgent } from "../domain/agents.ts";
import type { Store } from "../domain/store.ts";
import { badRequest, errorMessage, notFound } from "../errors.ts";
import type { Handlers } from "./router.ts";

export function teamHandlers(store: Store, apc: ApcSync, roots: TemplateRoot[]) {
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
      const picked = templates.map((id) => ({ id, file: files.find((f) => f.id === id) }));
      const slugs = new Set(picked.flatMap((p) => (p.file ? [p.file.slug] : [])));
      const skipped: Array<{ template: string; reason: string }> = [];
      const written: string[] = [];
      for (const { id, file } of picked) {
        if (!file) {
          skipped.push({ template: id, reason: "no such template" });
          continue;
        }
        if (taken.has(file.slug) || written.includes(file.slug)) {
          skipped.push({ template: id, reason: `the project already has ${file.slug}` });
          continue;
        }
        // Keep the team's own shape; whoever has no parent among what is installed hangs under `hang_under`.
        const parent = file.parent && slugs.has(file.parent) ? file.parent : (hang_under ?? "");
        try {
          writeAgentFromTemplate(root, file.slug, file.text, parent);
          written.push(file.slug);
        } catch (err) {
          skipped.push({ template: id, reason: errorMessage(err) });
        }
      }
      if (written.length) apc.sync(project_id);
      const installed = written.flatMap((slug) => {
        const a = store.agents.forFile(project_id, slug, []);
        return a ? [publicAgent(a)] : [];
      });
      return { installed, skipped };
    },
  } satisfies Partial<Handlers>;
}
