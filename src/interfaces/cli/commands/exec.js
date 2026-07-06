import { http } from "../http.js";
import { resolveProjectId } from "./project.js";
import { CHANNELS } from "#core/constants/channels.js";

/**
 * Resolve exec target from CLI args.
 * Default (no agent): super-agent daemon route.
 * Explicit: -a / --agent <slug>
 * Legacy: apx exec <slug> "prompt" when 2+ positionals
 */
export function resolveExecRequest(args) {
  const agentFlag = args.flags?.agent ?? args.flags?.a;
  let slug = null;
  let promptParts;

  if (agentFlag && agentFlag !== true) {
    slug = String(agentFlag);
    promptParts = args._;
  } else if (args._.length >= 2) {
    slug = args._[0];
    promptParts = args._.slice(1);
  } else {
    promptParts = args._;
  }

  const useSuperAgent = !slug || slug === "super-agent";
  return {
    slug: useSuperAgent ? null : slug,
    useSuperAgent,
    promptParts,
  };
}

// Valid channel strings the daemon knows how to route.
const KNOWN_CHANNELS = new Set(Object.values(CHANNELS));

/**
 * Resolve which channel `apx exec` should tag the turn with.
 * Default: CHANNELS.CLI (unchanged behaviour).
 *   --code / -c        → CHANNELS.CODE (coding system prompt + code tools)
 *   --channel <name>   → explicit channel (must be a known channel string)
 */
export function resolveExecChannel(args) {
  const flags = args?.flags || {};
  if (flags.code) return CHANNELS.CODE;

  const raw = flags.channel;
  if (raw && raw !== true) {
    const channel = String(raw).toLowerCase();
    if (!KNOWN_CHANNELS.has(channel)) {
      throw new Error(
        `apx exec: unknown channel "${raw}". Known channels: ${[...KNOWN_CHANNELS].join(", ")}`
      );
    }
    return channel;
  }

  return CHANNELS.CLI;
}

async function readPromptFromStdin() {
  const fs = await import("node:fs");
  if (process.stdin.isTTY) return "";
  const chunks = [];
  const buf = Buffer.alloc(65536);
  try {
    while (true) {
      const n = fs.readSync(0, buf, 0, buf.length);
      if (!n) break;
      chunks.push(buf.slice(0, n).toString("utf8"));
    }
  } catch {
    /* empty */
  }
  return chunks.join("").trim();
}

export async function cmdExec(args) {
  const { slug, useSuperAgent, promptParts } = resolveExecRequest(args);
  let prompt = promptParts.join(" ").trim();

  if (!prompt || prompt === "-") {
    prompt = await readPromptFromStdin();
  }
  if (!prompt) {
    throw new Error(
      'apx exec: prompt is empty. Usage: apx exec "prompt" | apx exec --code "prompt" | apx exec -a <agent> "prompt" | apx exec -- "prompt"'
    );
  }

  const pid = await resolveProjectId(args?.flags?.project);
  const body = {
    prompt,
    channel: resolveExecChannel(args),
    channelMeta: { cwd: process.cwd() },
  };
  if (args.flags.model && args.flags.model !== true) body.model = args.flags.model;
  if (args.flags.temperature) body.temperature = parseFloat(args.flags.temperature);
  if (args.flags["max-tokens"]) body.maxTokens = parseInt(args.flags["max-tokens"], 10);

  if (useSuperAgent) {
    const result = await http.post(`/projects/${pid}/super-agent/chat`, body);
    process.stdout.write(result.text + "\n");
    if (process.stderr.isTTY || args.flags.verbose) {
      process.stderr.write(
        `\n— ${result.name || "super-agent"} | model=${result.trace ? "tools" : "engine"} | in=${result.usage?.input_tokens || "?"} out=${result.usage?.output_tokens || "?"}${result.model ? ` | ${result.model}` : ""}\n`
      );
    }
    return;
  }

  const result = await http.post(`/projects/${pid}/agents/${slug}/exec`, body);

  process.stdout.write(result.text + "\n");
  if (process.stderr.isTTY || args.flags.verbose) {
    process.stderr.write(
      `\n— ${result.engine} | in=${result.usage?.input_tokens || "?"} out=${result.usage?.output_tokens || "?"} | conv=${result.conversation.id}\n`
    );
  }
}
