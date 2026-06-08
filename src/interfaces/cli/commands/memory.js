import fs from "node:fs";
import { findApfRoot } from "../../../core/parser.js";
import { agentMemoryPath, readAgentMemory, writeAgentMemory, ensureAgentRuntimeDir } from "../../../core/agent-memory.js";
import { http } from "../http.js";

function requireRoot() {
  const root = findApfRoot();
  if (!root) throw new Error("not inside an APC project (run `apx init` first)");
  return root;
}

async function nudgeDaemon(root) {
  try {
    if (!(await http.ping())) return;
    const projects = await http.get("/projects", { autoStart: false });
    const me = projects.find((p) => p.path === root);
    if (me) await http.post(`/projects/${me.id}/rebuild`, undefined, { autoStart: false });
  } catch {}
}

export async function cmdMemory(args) {
  const slug = args._[0];
  if (!slug) throw new Error("apx memory: missing <agent-slug>");
  const root = requireRoot();
  const memPath = agentMemoryPath(root, slug);

  if (args.flags.replace) {
    const newBody = readStdinSync();
    writeAgentMemory(root, slug, newBody);
    await nudgeDaemon(root);
    console.log(`replaced memory for ${slug} (${Buffer.byteLength(newBody)} bytes)`);
    return;
  }

  if (args.flags.append && args.flags.append !== true) {
    const note = String(args.flags.append);
    ensureAgentRuntimeDir(root, slug);
    let body = readAgentMemory(root, slug);
    if (!/##\s+Recent context/i.test(body)) {
      body += body.endsWith("\n") ? "\n## Recent context\n" : "\n\n## Recent context\n";
    }
    const today = new Date().toISOString().slice(0, 10);
    body = body.replace(/(##\s+Recent context\s*\n)/i, `$1- ${today}: ${note}\n`);
    writeAgentMemory(root, slug, body);
    await nudgeDaemon(root);
    console.log(`appended to ${slug} memory: ${note}`);
    return;
  }

  const body = readAgentMemory(root, slug);
  if (!body && !fs.existsSync(memPath)) {
    throw new Error(`no memory for "${slug}" — agent dir not yet created`);
  }
  process.stdout.write(body);
}

function readStdinSync() {
  const chunks = [];
  const buf = Buffer.alloc(65536);
  try {
    while (true) {
      const bytes = fs.readSync(0, buf, 0, buf.length);
      if (!bytes) break;
      chunks.push(buf.slice(0, bytes).toString("utf8"));
    }
  } catch {}
  return chunks.join("");
}
