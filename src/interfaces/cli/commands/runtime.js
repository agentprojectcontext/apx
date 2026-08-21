import { http } from "../http.js";
import { resolveProjectId } from "./project.js";

const SLUG_RE = /^[a-z][a-z0-9_-]*$/;

// Resolve the OPTIONAL agent and the prompt positionals for `apx run`. The APX
// agent only shapes the system prompt handed to the external CLI — the CLI has
// its own agency — so no agent means a pass-through:
//   apx run --runtime claude-code "<prompt>"              → { slug: null }  (pass-through)
//   apx run -a reviewer --runtime claude-code "<prompt>"  → { slug: "reviewer" }
//   apx run reviewer --runtime claude-code "<prompt>"     → legacy positional (still works)
// A SINGLE positional is always the prompt, so a quoted pass-through prompt is
// never mistaken for an agent.
export function resolveRunAgent(flags = {}, positionals = []) {
  const flagVal =
    (flags.agent && flags.agent !== true) ? String(flags.agent) :
    (flags.a && flags.a !== true) ? String(flags.a) : null;
  let slug = flagVal;
  let rest = positionals.slice();
  if (!slug && rest.length >= 2 && SLUG_RE.test(rest[0])) {
    slug = rest[0];
    rest = rest.slice(1);
  }
  return { slug: slug || null, positionals: rest };
}

export async function cmdRun(args) {
  const runtime = args.flags.runtime === true ? null : args.flags.runtime;
  if (!runtime) throw new Error("apx run: --runtime required (claude-code | codex | opencode | aider | cursor-agent | gemini-cli | qwen-code | antigravity)");

  const { slug, positionals } = resolveRunAgent(args.flags, args._);

  let prompt = positionals.join(" ").trim();
  if (!prompt || prompt === "-") {
    const fs = await import("node:fs");
    if (!process.stdin.isTTY) {
      const chunks = [];
      const buf = Buffer.alloc(65536);
      try {
        while (true) {
          const n = fs.readSync(0, buf, 0, buf.length);
          if (!n) break;
          chunks.push(buf.slice(0, n).toString("utf8"));
        }
      } catch {}
      prompt = chunks.join("").trim();
    }
  }
  if (!prompt) throw new Error("apx run: prompt is empty");

  const pid = await resolveProjectId(args?.flags?.project);
  const timeoutMs = args.flags.timeout
    ? parseInt(args.flags.timeout, 10) * 1000
    : undefined;

  const endpoint = slug
    ? `/api/projects/${pid}/agents/${slug}/runtime`
    : `/api/projects/${pid}/runtime`;
  const result = await http.post(endpoint, { runtime, prompt, timeoutMs });

  if (result.output) process.stdout.write(result.output + "\n");
  if (process.stderr.isTTY || args.flags.verbose) {
    process.stderr.write(`\n— ${runtime} | exit ${result.exit_code}`);
    if (result.external_session_path) {
      process.stderr.write(` | session: ${result.external_session_path}`);
    }
    process.stderr.write("\n");
  }
  process.exit(result.exit_code === 0 ? 0 : 1);
}

export async function cmdEnvDetect() {
  const probes = await http.get("/api/env/detect");
  const groups = { runtime: [], engine: [], tool: [] };
  for (const p of probes) {
    (groups[p.category] || groups.tool).push(p);
  }
  for (const [cat, items] of Object.entries(groups)) {
    if (!items.length) continue;
    console.log(`\n${cat.toUpperCase()}:`);
    for (const p of items) {
      const mark = p.installed ? "✓" : "·";
      const ver = p.installed ? p.version : `(${p.reason || "not found"})`;
      console.log(`  ${mark} ${p.id.padEnd(14)} ${p.binary.padEnd(14)} ${ver}`);
    }
  }
}
