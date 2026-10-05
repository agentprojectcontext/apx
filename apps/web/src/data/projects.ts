// A project's own settings (projects.update): kept in its .apc/project.json by the core.
import type { Params, Project } from "@apx/protocol";
import { t } from "../i18n/index.ts";
import { client } from "./client.ts";
import { notify } from "./notices.ts";
import { data } from "./state.ts";

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** Saves the change and shows it everywhere the project is listed; the project, or nothing when it failed. */
export async function updateProject(p: Params<"projects.update">): Promise<Project | undefined> {
  try {
    const { project } = await client.call("projects.update", p);
    data.set((s) => ({ projects: s.projects.map((x) => (x.id === project.id ? project : x)) }));
    return project;
  } catch (e) {
    notify(t("error.change", { error: errText(e) }));
    return undefined;
  }
}
