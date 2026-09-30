import fs from "node:fs";
import nodePath from "node:path";
import { resolveProject, safePathJoin } from "../helpers.js";
import { planPatch, PatchError } from "../patch/apply-patch.js";

export default {
  name: "apply_patch",
  schema: {
    type: "function",
    function: {
      name: "apply_patch",
      description:
        "Edit files with a patch: add, update (with context hunks), move or delete, several files at once, all or nothing. " +
        "Format:\n*** Begin Patch\n*** Update File: src/app.js\n@@ function start\n context line\n-old line\n+new line\n" +
        "*** Add File: src/new.js\n+first line\n*** Delete File: src/old.js\n*** End Patch\n" +
        "Paths are relative to the project root. Keep 2-3 unchanged context lines around each change; " +
        "`@@ <line>` anchors a hunk after that line when the context repeats.",
      parameters: {
        type: "object",
        properties: {
          project: { type: "string" },
          patch: { type: "string", description: "the full patch text, from *** Begin Patch to *** End Patch" },
        },
        required: ["patch"],
      },
    },
  },
  makeHandler: ({ projects, requirePermission }) => async ({ project, patch, confirmed = false }) => {
    if (!patch) throw new Error("apply_patch: patch required");
    const p = resolveProject(projects, project);
    const abs = (rel) => safePathJoin(p.path, rel);
    let plan;
    try {
      plan = planPatch(patch, {
        exists: (rel) => fs.existsSync(abs(rel)),
        read: (rel) => fs.readFileSync(abs(rel), "utf8"),
      });
    } catch (e) {
      if (e instanceof PatchError) return { error: e.message, applied: false };
      throw e;
    }
    await requirePermission("apply_patch", { dangerous: true, confirmed, args: { files: plan.map((c) => c.path) } });
    for (const change of plan) {
      const target = abs(change.path);
      if (change.action === "delete") fs.rmSync(target, { force: true });
      else {
        fs.mkdirSync(nodePath.dirname(target), { recursive: true });
        fs.writeFileSync(target, change.content, "utf8");
      }
    }
    return {
      ok: true,
      applied: plan.map((c) => ({ path: c.path, action: c.action, ...(c.from ? { from: c.from } : {}) })),
    };
  },
};
