import { z } from "zod";
import { settingsRepo } from "./settings.ts";
import type { Sql } from "./sql.ts";

const Protection = z.array(z.object({ migration: z.string(), project: z.string() }));
const KEY = "protected_project_files";

export function projectProtectionRepo(q: Sql) {
  const settings = settingsRepo(q);
  const list = () => Protection.parse(JSON.parse(settings.get(KEY) ?? "[]"));
  return {
    list,
    protect(migration: string, project: string) {
      settings.set(KEY, JSON.stringify([...list().filter((p) => p.migration !== migration), { migration, project }]));
    },
    restore(migration: string) {
      settings.set(KEY, JSON.stringify(list().filter((p) => p.migration !== migration)));
    },
  };
}
