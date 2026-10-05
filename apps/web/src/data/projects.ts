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

/** Stop listing a project; its history and folder stay in place. */
export async function unregisterProject(project: string): Promise<boolean> {
  try {
    await client.call("projects.unregister", { project });
    data.set((s) => ({
      projects: s.projects.map((item) => (item.id === project ? { ...item, registered: false } : item)),
    }));
    return true;
  } catch (e) {
    notify(t("error.change", { error: errText(e) }));
    return false;
  }
}

/**
 * Names, describes or types the base project. The project list is replaced too, so everything that lists projects
 * (sidebar, pickers, groups) shows the new name.
 */
export async function updateBase(p: Params<"projects.update_base">): Promise<boolean> {
  try {
    const { base } = await client.call("projects.update_base", p);
    data.set((s) => ({ base, projects: [...s.projects] }));
    return true;
  } catch (e) {
    notify(t("error.change", { error: errText(e) }));
    return false;
  }
}
