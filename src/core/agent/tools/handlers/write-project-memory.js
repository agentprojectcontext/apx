import fs from "node:fs";
import {
  appendProjectLocalMemory,
  readProjectLocalMemory,
  writeProjectLocalMemory,
  projectLocalMemoryPath,
} from "#core/stores/project-memory.js";
import { projectMeta, resolveProject } from "../helpers.js";

// Write a project's LOCAL memory (~/.apx/projects/<apxId>/memory.md) as a
// DOCUMENT. `remember` with a `project` already appends one dated sentence
// there; this is the other half — the whole body — mirroring the `mode:
// "replace"` that `write_agent_memory` has always had for an agent's memory.
//
// THE FAILURE THIS FIXES, from a real install: asked to store a full survey of
// Postbean — sections, a pricing table, operational notes — the super-agent had
// no tool shaped like that. `remember` takes "one self-contained sentence", so
// a five-page relevamiento did not fit it, and the model reached for the only
// tools that did: `write_file` at the repo root. A `memory.md` landed inside
// the Postbean repository — which nothing reads (not the Memories screen, not
// the RAG indexer) and which deploys to production on every push. Telling the
// model "never create a memory file yourself" was already in `remember`'s
// description; what was missing was somewhere else to put it.
//
// Still the LOCAL file, never the repo's committed `.apc/memory.md`: an
// automatic writer aimed at a committed file is how a token pasted into a chat
// ends up in a public git history. Promotion is the owner's move, in the
// Memories screen, which shows both files side by side.
export default {
  name: "write_project_memory",
  schema: {
    type: "function",
    function: {
      name: "write_project_memory",
      description:
        "Write a PROJECT's local memory document (~/.apx/projects/<id>/memory.md — the file its Memories screen shows). Use it when what you have to store is a DOCUMENT: a survey of the project, its stack, its plans, sections and tables. For a single durable sentence use `remember` with `project` instead. mode 'append' adds one dated bullet (same as remember); mode 'replace' rewrites the whole body, after a timestamped backup — read the current body first and keep what is still true. NEVER create a memory file yourself with write_file or run_shell: a memory written into the repo is read by nothing and gets committed. This tool deliberately writes the LOCAL file, not the repo's .apc/memory.md.",
      parameters: {
        type: "object",
        required: ["project", "content"],
        properties: {
          project: { type: "string", description: "Project id, name or path (from list_projects)." },
          content: { type: "string", description: "The note (append mode) or the full memory body in markdown (replace mode)." },
          mode:    { type: "string", enum: ["append", "replace"], description: "append (default) adds one dated bullet; replace rewrites the whole document." },
        },
      },
    },
  },
  makeHandler: (ctx = {}) => async ({ project, content, mode = "append" } = {}) => {
    if (!project || !String(project).trim()) return { error: "project required" };
    if (!content || !String(content).trim()) return { error: "content required" };

    let p;
    try {
      p = resolveProject(ctx.projects, String(project).trim());
    } catch (e) {
      return { error: e.message };
    }
    const meta = projectMeta(ctx.projects, p);

    try {
      if (mode === "replace") {
        // Overwriting a memory wholesale is the one destructive move here, so
        // it asks, and it leaves a copy behind either way.
        if (ctx.requirePermission) {
          await ctx.requirePermission("write_project_memory", { dangerous: true, args: { project: meta.name, mode } });
        }
        const file = projectLocalMemoryPath(p);
        let backup = "";
        const previous = readProjectLocalMemory(p);
        if (previous) {
          backup = `${file}.bak-${new Date().toISOString().slice(0, 10)}`;
          fs.copyFileSync(file, backup);
        }
        const { bytes } = writeProjectLocalMemory(p, String(content));
        return { ok: true, mode, project: meta, path: file, bytes, ...(backup ? { backup } : {}) };
      }

      const r = appendProjectLocalMemory(p, String(content), {
        channel: ctx.channel || "",
        projectName: meta.name,
      });
      return { ok: true, mode: "append", project: meta, path: r.path, bytes: r.bytes };
    } catch (e) {
      return { error: e.message };
    }
  },
};
