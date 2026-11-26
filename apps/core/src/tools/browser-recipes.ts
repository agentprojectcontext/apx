// Browser recipes: a browser_do sequence saved under a name in the project (`.apx/browser-recipes/<name>.json`), so
// repeating it costs one short call. Plain data, never code: it runs only through browser_do (DECISIONS.md#d-265).

import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import { projectDir } from "../apc/folder.ts";
import { BrowserStep, variablesOf } from "./browser-steps.ts";

export const RECIPE_NAME = /^[a-z0-9][a-z0-9-]{1,59}$/;
export const MAX_STEPS = 40;

export const BrowserRecipe = z
  .object({
    name: z.string().regex(RECIPE_NAME),
    about: z.string().max(300),
    vars: z.array(z.string()).max(20),
    steps: z.array(BrowserStep).min(1).max(MAX_STEPS),
    saved_at: z.string(),
    by: z.string(),
  })
  .strict();
export type BrowserRecipe = z.infer<typeof BrowserRecipe>;

const folderOf = (root: string) => path.join(projectDir(root), "browser-recipes");

/** The recipes saved in a project folder, by name (a file that does not parse is left out). */
export function listRecipes(projectDir: string): BrowserRecipe[] {
  const dir = folderOf(projectDir);
  const names = fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f.endsWith(".json")) : [];
  return names.flatMap((f) => {
    const r = readRecipe(projectDir, f.slice(0, -5));
    return r ? [r] : [];
  });
}

export function readRecipe(projectDir: string, name: string): BrowserRecipe | undefined {
  if (!RECIPE_NAME.test(name)) return undefined;
  try {
    const raw = JSON.parse(fs.readFileSync(path.join(folderOf(projectDir), `${name}.json`), "utf8"));
    const r = BrowserRecipe.safeParse(raw);
    return r.success && r.data.name === name ? r.data : undefined;
  } catch {
    return undefined;
  }
}

/** Saves (or replaces) a recipe; its variables are the `{{name}}`s its steps use. */
export function saveRecipe(
  projectDir: string,
  r: { name: string; about: string; steps: BrowserStep[]; by: string; at: string },
): BrowserRecipe {
  const recipe = BrowserRecipe.parse({
    name: r.name,
    about: r.about,
    vars: variablesOf(r.steps),
    steps: r.steps,
    saved_at: r.at,
    by: r.by,
  });
  const dir = folderOf(projectDir);
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${r.name}.json`);
  fs.writeFileSync(`${file}.tmp`, `${JSON.stringify(recipe, null, 2)}\n`);
  fs.renameSync(`${file}.tmp`, file);
  return recipe;
}
