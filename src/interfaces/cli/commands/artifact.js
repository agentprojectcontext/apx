import { http } from "../http.js";
import { resolveProjectId } from "./project.js";

export async function cmdArtifactCreate(args) {
  const name = args._[0];
  if (!name) throw new Error("apx artifact create: missing <name>");
  const pid = await resolveProjectId(args?.flags?.project);
  const content = args.flags.content && args.flags.content !== true ? String(args.flags.content) : "";
  const r = await http.post(`/projects/${pid}/artifacts`, { name, content });
  console.log(r.path);
}

export async function cmdArtifactList(args = {}) {
  const pid = await resolveProjectId(args?.flags?.project);
  const rows = await http.get(`/projects/${pid}/artifacts`);
  if (rows.length === 0) {
    console.log(`(no artifacts in project #${pid})`);
    return;
  }
  console.log(`project #${pid} artifacts:`);
  console.log("NAME".padEnd(30) + " SIZE   MODIFIED");
  for (const a of rows) {
    console.log(
      a.name.padEnd(30) + " " +
      String(a.size).padEnd(6) + " " +
      (a.modified || "—")
    );
  }
}

export async function cmdArtifactShow(args) {
  const name = args._[0];
  if (!name) throw new Error("apx artifact show: missing <name>");
  const pid = await resolveProjectId(args?.flags?.project);
  const r = await http.get(`/projects/${pid}/artifacts/${encodeURIComponent(name)}`);
  process.stdout.write(r.content);
}

export async function cmdArtifactRemove(args) {
  const name = args._[0];
  if (!name) throw new Error("apx artifact remove: missing <name>");
  const pid = await resolveProjectId(args?.flags?.project);
  await http.delete(`/projects/${pid}/artifacts/${encodeURIComponent(name)}`);
  console.log(`removed artifact "${name}"`);
}
