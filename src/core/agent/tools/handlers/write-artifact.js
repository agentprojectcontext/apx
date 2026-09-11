import { createArtifact, listArtifacts, readArtifact } from "#core/stores/artifacts.js";
import { resolveProject } from "../helpers.js";

/**
 * Artifacts are the one place an agent can leave a RUNNABLE file.
 *
 * `write_file` writes into the project's repo, and a script an agent wrote
 * without anyone reading it does not belong on a committed path. An artifact
 * lives in the project's own storage (~/.apx/projects/<id>/artifacts/), which
 * is also where a routine's `artifact:<name>` pre/post command looks — so
 * "write me a tool that reports X" and "run that tool before every review"
 * are the same file.
 *
 * The build-mode prompt used to send the agent to `<repo>/artifacts/` with
 * write_file, which is the same directory ONLY for the default project. On any
 * registered project the Artifacts tab stayed empty and the routine reference
 * pointed at nothing. This tool is the answer to that.
 */
export default {
  name: "write_artifact",
  schema: {
    type: "function",
    function: {
      name: "write_artifact",
      description:
        "Create or replace an artifact: a managed file in the project's storage that routines can run " +
        "as a pre/post command (`artifact:<name>`) and that shows in the Artifacts tab. Use it for a " +
        "script or data file you are asked to BUILD for a project — not for source code, which belongs " +
        "in the repo via write_file. A script starting with #! is made executable.",
      parameters: {
        type: "object",
        properties: {
          project: { type: "string", description: "Project id, name or path. Omit for the current one." },
          name: { type: "string", description: "File name, e.g. `source-board.mjs`. A name, never a path." },
          content: { type: "string" },
          overwrite: { type: "boolean", description: "Replace it if it already exists. Default false." },
        },
        required: ["name", "content"],
      },
    },
  },
  makeHandler: ({ projects, requirePermission }) => async ({ project, name, content, overwrite = false, confirmed = false }) => {
    await requirePermission("write_artifact", { dangerous: true, confirmed, args: { name } });
    const p = resolveProject(projects, project);
    const existed = listArtifacts(p.storagePath).some((a) => a.name === name);
    const path = createArtifact(p.storagePath, name, String(content ?? ""), { overwrite });
    return {
      ok: true,
      name,
      path,
      replaced: existed,
      // How to wire it up, because the next question is always that one.
      reference: `artifact:${name}`,
      previous: existed && overwrite ? undefined : null,
    };
  },
};

export { readArtifact };
