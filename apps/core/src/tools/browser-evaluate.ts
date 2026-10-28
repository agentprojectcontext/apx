import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { BROWSER_CAP } from "@apx/protocol";
import { z } from "zod";
import type { Store } from "../domain/store.ts";
import { folderAccess, outsideFolders } from "./folders.ts";
import { untrusted } from "./result.ts";
import { defineTool, type ToolContext } from "./types.ts";

const Args = z.object({
  tab: z.string().min(1),
  script: z.string().min(1).max(64_000).optional().describe("JavaScript expression; use an async IIFE for statements"),
  path: z.string().min(1).max(500).optional().describe("local .js file instead of script, relative to the work folder"),
  sha256: z
    .string()
    .regex(/^[a-f0-9]{64}$/)
    .optional()
    .describe("required with path: SHA-256 of the exact approved file bytes"),
});

export function browserEvaluateTool(
  store: Store,
  home: string,
  own: (ctx: ToolContext, tab: string) => Promise<string>,
  vm?: { hasThread(id: string): boolean },
) {
  return defineTool({
    name: "browser_evaluate",
    needsCap: BROWSER_CAP,
    description:
      "Run JavaScript in this APX browser tab, inline or from a local .js with its sha256. Always asks for approval, even in Total: arbitrary code can send or expose private page data. Never use for passwords, 2FA or card data. Awaited expression result is bounded JSON, untrusted. Do not retry an uncertain send; verify with a snapshot.",
    args: Args,
    effect: "external",
    confirm: "always",
    keepsCard: () => "card",
    deadlineMs: 30_000,
    title: () => "Ran browser JavaScript",
    check(a, ctx) {
      if (a.path !== undefined && vm?.hasThread(ctx.thread.id))
        throw new Error("VM browser scripts must be inline; host file access refused");
      if ((a.script === undefined) === (a.path === undefined)) throw new Error("provide exactly one of script or path");
      if (a.path !== undefined && (!/\.js$/i.test(a.path) || !a.sha256))
        throw new Error("a local .js path requires its sha256");
      if (a.script !== undefined && a.sha256 !== undefined) throw new Error("sha256 is only for a local .js file");
    },
    outside: (a, ctx) =>
      a.path === undefined
        ? []
        : outsideFolders((lent) => ({
            ...folderAccess(store, home, { ...ctx.thread, lent }, a.path ?? ""),
            write: false,
          })),
    async run(a, ctx) {
      if (!ctx.callAsOwner) return "not run: the owner did not approve JavaScript execution";
      const tab = await own(ctx, a.tab);
      let script = a.script;
      if (a.path !== undefined) {
        if (vm?.hasThread(ctx.thread.id))
          throw new Error("VM browser scripts must be inline; host file access refused");
        const location = folderAccess(store, home, ctx.thread, a.path);
        if ("refused" in location) throw new Error(location.refused);
        if (location.at.split(path.sep).includes(".git")) throw new Error("the .git folder is off limits");
        const file = fs.openSync(location.at, fs.constants.O_RDONLY | (fs.constants.O_NONBLOCK ?? 0));
        try {
          const stat = fs.fstatSync(file);
          if (!stat.isFile() || stat.size > 64_000)
            throw new Error("JavaScript file must be a regular file of at most 64000 bytes");
          const buffer = Buffer.alloc(64_001);
          const size = fs.readSync(file, buffer, 0, buffer.length, 0);
          if (size > 64_000) throw new Error("JavaScript file exceeds 64000 bytes");
          const bytes = buffer.subarray(0, size);
          if (bytes.includes(0)) throw new Error("JavaScript file must be text");
          if (createHash("sha256").update(bytes).digest("hex") !== a.sha256)
            throw new Error("JavaScript file changed: read it again and approve its new sha256");
          script = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
        } finally {
          fs.closeSync(file);
        }
      }
      if (!script?.trim()) throw new Error("empty JavaScript script");
      const result = await ctx.callAsOwner("browser.evaluate", { tab, script, by: ctx.agent.id });
      return untrusted("web_javascript", { tab, source: result.url }, result.json);
    },
  });
}
