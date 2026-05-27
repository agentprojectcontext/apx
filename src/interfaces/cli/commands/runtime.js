import { http } from "../http.js";
import { resolveProjectId } from "./project.js";

export async function cmdRun(args) {
  const slug = args._[0];
  if (!slug) throw new Error("apx run: usage: apx run <agent> --runtime <id> \"<prompt>\"");
  const runtime = args.flags.runtime === true ? null : args.flags.runtime;
  if (!runtime) throw new Error("apx run: --runtime required (claude-code | codex | opencode | aider | cursor-agent | gemini-cli | qwen-code)");

  let prompt = args._.slice(1).join(" ").trim();
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

  const result = await http.post(
    `/projects/${pid}/agents/${slug}/runtime`,
    { runtime, prompt, timeoutMs }
  );

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
  const probes = await http.get("/env/detect");
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
