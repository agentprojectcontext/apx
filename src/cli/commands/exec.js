import { http } from "../http.js";
import { resolveProjectId } from "./project.js";

function readStdinSync() {
  if (process.stdin.isTTY) return "";
  const chunks = [];
  const buf = Buffer.alloc(65536);
  try {
    while (true) {
      const n = require("node:fs").readSync(0, buf, 0, buf.length);
      if (!n) break;
      chunks.push(buf.slice(0, n).toString("utf8"));
    }
  } catch {}
  return chunks.join("");
}

export async function cmdExec(args) {
  const slug = args._[0];
  if (!slug) throw new Error("apx exec: usage: apx exec <agent> \"<prompt>\"  [--model <id>]");
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
  if (!prompt) throw new Error("apx exec: prompt is empty (pass as args or via stdin)");

  const pid = await resolveProjectId(args?.flags?.project);
  const body = { prompt };
  if (args.flags.model && args.flags.model !== true) body.model = args.flags.model;
  if (args.flags.temperature) body.temperature = parseFloat(args.flags.temperature);
  if (args.flags["max-tokens"]) body.maxTokens = parseInt(args.flags["max-tokens"], 10);

  const result = await http.post(
    `/projects/${pid}/agents/${slug}/exec`,
    body
  );

  process.stdout.write(result.text + "\n");
  if (process.stderr.isTTY || args.flags.verbose) {
    process.stderr.write(
      `\n— ${result.engine} | in=${result.usage?.input_tokens || "?"} out=${result.usage?.output_tokens || "?"} | conv=${result.conversation.id}\n`
    );
  }
}
