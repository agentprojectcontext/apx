import { http } from "../http";

export type SkillEntry = {
  slug: string;
  source: "bundled" | "user" | "project" | string;
  description: string;
};

export type SkillsList = {
  count: number;
  skills: SkillEntry[];
};

export const Skills = {
  /**
   * List installed skills (bundled + user + optional project-scoped). The
   * description is already condensed for one-line rendering.
   */
  list: (projectPath?: string) =>
    http.get<SkillsList>(
      projectPath
        ? `/skills?project_path=${encodeURIComponent(projectPath)}`
        : "/skills",
    ),
};
