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

// Braille spinner frames for the live "pensando…" indicator.
const SPINNER = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
const dim = (s) => `\x1b[2m${s}\x1b[0m`;

/**
 * A single-line progress indicator drawn on stderr while the super-agent turn
 * runs, so `apx exec` never looks frozen. Renders only on an interactive stderr
 * (TTY); when piped/redirected it is a no-op so stdout stays clean for scripts.
 * Set APX_NO_SPINNER=1 to disable.
 */
function createExecStatus() {
  const active =
    process.stderr.isTTY && process.env.APX_NO_SPINNER !== "1" && !process.env.NO_COLOR;
  let label = "pensando…";
  let frame = 0;
  let timer = null;
  const t0 = Date.now();

  const draw = () => {
    const secs = Math.floor((Date.now() - t0) / 1000);
    process.stderr.write(`\r\x1b[2K${dim(SPINNER[frame])} ${label} ${dim(secs + "s")}`);
    frame = (frame + 1) % SPINNER.length;
  };

  return {
    start() {
      if (!active || timer) return;
      draw();
      timer = setInterval(draw, 90);
      timer.unref?.();
    },
    set(next) {
      if (next) label = next;
    },
    clear() {
      if (timer) {
        clearInterval(timer);
        timer = null;
      }
      if (active) process.stderr.write("\r\x1b[2K");
    },
  };
}

/** Map a stream event to the label shown next to the spinner. */
function labelForEvent(event) {
  switch (event?.type) {
    case "skill_inspector":
      return "cargando skills…";
    case "model_routed":
    case "model_start": {
      const m = event.model || event.to || event.engine;
      return m ? `pensando… ${dim(m)}` : "pensando…";
    }
    case "tool_start":
      return `${event.trace?.tool || event.tool || "herramienta"}…`;
    case "tool_result":
      return "pensando…";
    default:
      return null;
  }
}

// A session title has to be readable in a list of twenty, so it is the prompt's
// opening words rather than "New session" — the panel's session list is the
// only place a `--code` turn can be found again, and twelve rows all reading
// "New session" is the same as not finding it.
const TITLE_MAX = 60;
export function codeSessionTitle(prompt) {
  const flat = String(prompt || "").replace(/\s+/g, " ").trim();
  if (!flat) return "Code";
  const firstLine = flat.split(/(?<=[.?!])\s/)[0] || flat;
  const base = firstLine.length <= TITLE_MAX ? firstLine : flat;
  return base.length <= TITLE_MAX ? base : base.slice(0, TITLE_MAX - 1).trimEnd() + "…";
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

/**
 * Run one `--code` turn inside a persistent code session.
 *
 * `--session <id>` continues an existing one (the session carries the history,
 * mode, model and agent); without it a fresh session is created and titled from
 * the prompt. Either way the id is printed on stderr so the caller — a human or
 * an agent shelling out — knows exactly which session to open in the panel.
 */
async function runCodeSessionTurn({ args, pid, prompt, model }) {
  const flagged = args.flags.session;
  let sid = typeof flagged === "string" && flagged.trim() ? flagged.trim() : null;
  let created = false;

  if (!sid) {
    // No agentSlug here on purpose: `-a <slug>` never reaches this path — it
    // sets useSuperAgent=false and routes to the agent's own exec endpoint.
    const session = await http.post(`/api/projects/${pid}/code/sessions`, {
      title: codeSessionTitle(prompt),
      ...(model ? { model } : {}),
    });
    sid = session.id;
    created = true;
  }

  const status = createExecStatus();
  status.start();
  let result;
  try {
    result = await http.streamPost(
      `/api/projects/${pid}/code/sessions/${sid}/chat/stream`,
      { prompt, channel: CHANNELS.CODE, cwd: process.cwd(), confirm: false },
      (event) => status.set(labelForEvent(event))
    );
  } catch (e) {
    // Name the session even on failure: the user turn is already stored there,
    // so that is where the half-finished run can be inspected and resumed.
    process.stderr.write(
      `\n— code session ${sid}${created ? " (new)" : ""} | project ${pid} | ${http.baseUrl()}/m/code\n`
    );
    throw e;
  } finally {
    status.clear();
  }

  // A turn that produced no text is a failed turn, not an empty answer. Saying
  // so beats a blank line and exit 0, which reads as "it worked, silently".
  if (!result?.text) {
    throw new Error(
      `apx exec --code: the turn ended without a reply. Session ${sid} (project ${pid}) has the transcript: ${http.baseUrl()}/m/code`
    );
  }

  process.stdout.write(result.text + "\n");
  // Always tell the caller where the turn landed — a piped/scripted run needs
  // the id to pass back as --session, and a human needs it to find the session
  // in the panel. stderr keeps stdout clean for scripts.
  process.stderr.write(
    `\n— code session ${sid}${created ? " (new)" : ""} | project ${pid} | ${http.baseUrl()}/m/code\n`
  );
  if (process.stderr.isTTY || args.flags.verbose) {
    process.stderr.write(
      `— ${result.name || "super-agent"} | in=${result.usage?.input_tokens || "?"} out=${result.usage?.output_tokens || "?"}\n`
    );
  }
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
  const channel = resolveExecChannel(args);
  const body = {
    prompt,
    channel,
    channelMeta: { cwd: process.cwd() },
  };
  if (args.flags.model && args.flags.model !== true) body.model = args.flags.model;
  if (args.flags.temperature) body.temperature = parseFloat(args.flags.temperature);
  if (args.flags["max-tokens"]) body.maxTokens = parseInt(args.flags["max-tokens"], 10);

  // The code channel runs through a persistent code session instead of the
  // stateless super-agent route. Same output on stdout; the difference is that
  // the turn is now READABLE afterwards in the web panel (/m/code) and by the
  // next `--code` turn that continues the session, instead of existing only in
  // whatever terminal happened to run it.
  if (useSuperAgent && channel === CHANNELS.CODE) {
    return runCodeSessionTurn({ args, pid, prompt, model: body.model });
  }

  if (useSuperAgent) {
    // Stream the turn so we can render a live progress indicator instead of a
    // silent hang. `confirm: false` opts out of the interactive confirmation
    // round-trip (which the CLI can't answer), keeping the same semantics as the
    // blocking POST /super-agent/chat endpoint.
    const status = createExecStatus();
    status.start();
    let result;
    try {
      result = await http.streamPost(
        `/api/projects/${pid}/super-agent/chat/stream`,
        { ...body, confirm: false },
        (event) => status.set(labelForEvent(event))
      );
    } finally {
      status.clear();
    }
    process.stdout.write((result?.text ?? "") + "\n");
    if (process.stderr.isTTY || args.flags.verbose) {
      process.stderr.write(
        `\n— ${result?.name || "super-agent"} | model=${result?.trace ? "tools" : "engine"} | in=${result?.usage?.input_tokens || "?"} out=${result?.usage?.output_tokens || "?"}${result?.model ? ` | ${result.model}` : ""}\n`
      );
    }
    return;
  }

  const result = await http.post(`/api/projects/${pid}/agents/${slug}/exec`, body);

  process.stdout.write(result.text + "\n");
  if (process.stderr.isTTY || args.flags.verbose) {
    process.stderr.write(
      `\n— ${result.engine} | in=${result.usage?.input_tokens || "?"} out=${result.usage?.output_tokens || "?"} | conv=${result.conversation.id}\n`
    );
  }
}
