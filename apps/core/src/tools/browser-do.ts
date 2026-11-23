// browser_do: several browser actions in one call, the browser's screen_do. Every step goes through the same browser
// methods as browser_click and browser_type, as this agent, so the same rules hold (DECISIONS.md#d-267).
import { setTimeout as sleep } from "node:timers/promises";
import { BROWSER_CAP } from "@apx/protocol";
import { z } from "zod";
import type { Store } from "../domain/store.ts";
import { type BrowserRecipe, listRecipes, MAX_STEPS, RECIPE_NAME, readRecipe, saveRecipe } from "./browser-recipes.ts";
import { type BrowserStep, fill, runSteps, StepArg, stepText, toSteps } from "./browser-steps.ts";
import { workDir } from "./folders.ts";
import { cap, untrusted } from "./result.ts";
import { defineTool, type ScopedThread, type Tool, type ToolContext } from "./types.ts";

/** What a failure shows of the page: enough to fix the step without another snapshot. */
const FAILED_TREE_CHARS = 6000;
/** What the core reads of the page to find controls: never sent to the model. */
const FIND_CHARS = 60_000;
/** What `wait` reads of the page's text when the snapshot does not show it. */
const TEXT_CHARS = 50_000;

export function browserDoTool(
  store: Store,
  home: string,
  own: (ctx: Pick<ToolContext, "agent" | "call">, tab: string) => Promise<string>,
  card: (ctx: ToolContext, tab: string, state: "agent") => Promise<void>,
  /** A local file the agent may read, when `text` is its full path: a file field gets it attached, as browser_type does. */
  attachable: (text: string, thread: ScopedThread) => string | undefined,
): Tool {
  /** Recipes live in the thread's project (in the agent's work folder when it has none). */
  const projectDir = (ctx: Pick<ToolContext, "thread">) =>
    workDir(store, home, { project_id: ctx.thread.project_id ?? undefined });
  return defineTool({
    needsCap: BROWSER_CAP,
    name: "browser_do",
    description:
      "Several browser actions in one call: open, click, type, wait. Controls are named as the snapshot shows them; each step waits for its control, and the call stops at the first that fails, showing the page. Once a sequence works, save_as keeps it as a project recipe; later run it with recipe and vars ({{name}} in steps).",
    args: z.object({
      tab: z.string().min(1).describe("tab id"),
      steps: z.array(StepArg).min(1).max(MAX_STEPS).optional(),
      recipe: z.string().optional().describe("saved recipe to run"),
      vars: z.record(z.string(), z.string().max(10_000)).optional(),
      save_as: z.string().optional().describe("save the steps once all worked (a-z, 0-9, -)"),
      about: z.string().max(300).optional().describe("what the recipe does"),
      look: z.boolean().optional().describe("see the page after"),
    }),
    effect: "external",
    // Typing sends words to a site: after reading outside content, the owner decides, as with browser_type.
    confirm: (a) => (a.recipe || a.steps?.some((s) => s.do === "type") ? "untrusted" : "never"),
    untrustedWhy: "url_data",
    deadlineMs: 10 * 60_000,
    check(a, ctx) {
      if (!a.steps === !a.recipe) throw new Error("pass steps or recipe, not both");
      if (a.save_as && !a.steps) throw new Error("save_as saves steps; a recipe is already saved");
      if (a.save_as && !a.about?.trim()) throw new Error("say in about what the recipe does");
      for (const name of [a.recipe, a.save_as])
        if (name !== undefined && !RECIPE_NAME.test(name))
          throw new Error(`recipe names are 2-60 of a-z, 0-9 and -: ${name} is not one`);
      const given = a.steps ? toSteps(a.steps) : undefined;
      if (given && "error" in given) throw new Error(given.error);
      const steps = given?.steps ?? readRecipe(projectDir(ctx), a.recipe ?? "")?.steps;
      if (!steps) {
        const have = listRecipes(projectDir(ctx)).map((r) => r.name);
        throw new Error(
          `no recipe ${a.recipe} in this project${have.length ? `; saved: ${have.join(", ")}` : "; none saved yet"}`,
        );
      }
      const filled = fill(steps, a.vars ?? {});
      if ("missing" in filled) throw new Error(`missing vars: ${filled.missing.join(", ")}`);
    },
    title: (a) =>
      a.recipe
        ? `Ran recipe ${String(a.recipe)}`
        : `Browser: ${(Array.isArray(a.steps) ? a.steps : [])
            .map((s) => {
              const one = toSteps([s as StepArg]);
              return "steps" in one && one.steps[0] ? stepText(one.steps[0]) : "…";
            })
            .join(" → ")}`.slice(0, 160),
    async run(a, ctx) {
      const tab = await own(ctx, a.tab);
      const recipe: BrowserRecipe | undefined = a.recipe ? readRecipe(projectDir(ctx), a.recipe) : undefined;
      const given = a.steps ? toSteps(a.steps) : undefined;
      if (given && "error" in given) return `not run: ${given.error}`;
      const raw: BrowserStep[] = given?.steps ?? recipe?.steps ?? [];
      const filled = fill(raw, a.vars ?? {});
      if ("missing" in filled) return `not run: missing vars ${filled.missing.join(", ")}`;
      await card(ctx, tab, "agent");
      const by = ctx.agent.id;
      const out = await runSteps(filled.steps, {
        snapshot: async () => (await ctx.call("browser.snapshot", { tab, max_chars: FIND_CHARS })).tree,
        text: async () => (await ctx.call("browser.text", { tab, offset: 0, max_chars: TEXT_CHARS })).text,
        click: async (ref) => {
          await ctx.call("browser.click", { tab, ref, by });
        },
        type: async (ref, text, submit) => {
          const file = attachable(text, ctx.thread);
          await ctx.call("browser.type", {
            tab,
            ref,
            text: file ?? text,
            ...(file ? { upload: true } : {}),
            submit,
            by,
          });
        },
        open: async (url) => {
          await ctx.call("browser.navigate", { tab, url, by });
        },
        sleep: (ms) => sleep(ms, undefined, { signal: ctx.signal }),
        now: () => Date.now(),
      });
      const log = out.done.length ? out.done.join("\n") : "(no step done)";
      if (out.failed) {
        const left = filled.steps.length - out.failed.step;
        const page = out.failed.tree
          ? `\nthe page now:\n${untrusted("web_snapshot", { tab }, cap(out.failed.tree, FAILED_TREE_CHARS))}`
          : "";
        return `${log}\n${out.failed.step}. failed: ${out.failed.why}${left ? ` (${left} later step${left === 1 ? "" : "s"} not done)` : ""}${page}`;
      }
      const lines = [log, `all ${filled.steps.length} steps done.`];
      if (a.save_as && given) {
        const saved = saveRecipe(projectDir(ctx), {
          name: a.save_as,
          about: a.about?.trim() ?? "",
          steps: raw,
          by,
          at: new Date().toISOString(),
        });
        const vars = saved.vars.length ? ` with vars ${saved.vars.join(", ")}` : "";
        lines.push(`saved as recipe ${saved.name}${vars}.`);
        // A note in memory brings the recipe back when the same job comes up again.
        await ctx
          .call("memory.add", {
            text: `Browser recipe "${saved.name}": ${saved.about}. Run it with browser_do recipe "${saved.name}"${vars}.`,
            scope: ctx.thread.project_id ? "project" : "agent",
            tainted: ctx.untrusted(),
          })
          .then(
            () => lines.push("a memory note points to it."),
            () => undefined,
          );
      }
      if (a.look) {
        const r = await ctx.call("browser.snapshot", { tab, max_chars: 12_000 });
        lines.push(untrusted("web_snapshot", { tab }, cap(r.tree)));
      } else lines.push("Pass look: true, or take a browser_snapshot, if you need to see the page.");
      return lines.join("\n");
    },
  });
}
