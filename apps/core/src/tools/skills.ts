// load_skill: an agent reads the know-how a skill brings, when a task matches its one-line description.
import { z } from "zod";
import type { Store } from "../domain/store.ts";
import { readSkillFile, type SkillRoots, skillFiles, skillsFor } from "../skills/skills.ts";
import { artifactSources } from "./folders.ts";
import { cap } from "./result.ts";
import { defineTool, type Tool } from "./types.ts";

export function skillTools(store: Store, roots: SkillRoots): Tool[] {
  return [
    defineTool({
      name: "load_skill",
      description:
        "Load a skill's instructions (SKILL.md) by name, or another file it lists (file: relative path). Use it before a task that matches a skill in your catalog.",
      args: z.object({ name: z.string().min(1).max(64), file: z.string().max(300).optional() }),
      effect: "none",
      deadlineMs: 5_000,
      title: (a) =>
        a.file
          ? `Read ${String(a.file).split(/[\\/]/).at(-1)} from the skill ${a.name}`
          : `Loaded the skill ${String(a.name)}`,
      async run(a, ctx) {
        const skill = skillsFor(store, roots, ctx.thread.project_id).find(
          (s) => s.name.toLowerCase() === a.name.toLowerCase(),
        );
        if (!skill) return `no skill named ${a.name}`;
        // Paths a skill names by placeholder: where this chat's artifact sources live, and the skill's own folder.
        const text = readSkillFile(skill, a.file)
          .replaceAll("{{artifact_sources}}", artifactSources(roots.home, ctx.thread.project_id))
          .replaceAll("{{skill_dir}}", skill.dir);
        const files = a.file ? [] : skillFiles(skill);
        return `${cap(text, 30_000)}${files.length ? `\n\n[files in this skill: ${files.join(", ")}; read one with load_skill file=…]` : ""}`;
      },
    }),
  ];
}
