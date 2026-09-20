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

/**
 * Who `POST /turns/abort` should be told to stop, for a turn this command
 * started.
 *
 * The daemon addresses a running turn the way the client that started it can
 * name it (see api/turns.js): a code session by its id, the super-agent by the
 * CHANNEL it is speaking on — its thread IS the channel. `apx exec` knows both
 * of those, which is why Ctrl+C can now do something about them.
 *
 * `-a <slug>` is the one shape with no answer here, and the null is deliberate
 * rather than a shrug: that route (`POST /agents/:slug/exec`) does not register
 * an active turn at all, so there is nothing on the daemon side to abort and
 * pretending otherwise would be worse than saying so. The caller prints the
 * truth instead.
 */
export function execAbortTarget({ channel, codeSessionId = null, agentSlug = null }) {
  if (codeSessionId) return { code_session_id: codeSessionId };
  if (agentSlug) return null;
  return channel ? { channel } : null;
}

/**
 * Make Ctrl+C stop the TURN, not just this process.
 *
 * Before this, SIGINT killed the CLI and left the run going: the daemon kept
 * calling tools, kept spending tokens and persisted its answer into a thread
 * nobody was watching, while the person who pressed the key reasonably believed
 * they had cancelled something. The Stop button in the web panel has reached
 * `POST /turns/abort` for a while; the terminal had no way to say it.
 *
 * Two presses, because the first one has work to do: it asks the daemon to stop
 * and waits a moment for the answer. Somebody who does not want to wait presses
 * again and gets the process killed outright.
 */
function installInterrupt({ pid, target, onCancel }) {
  const ctrl = new AbortController();
  let pressed = 0;

  const onSigint = () => {
    pressed += 1;
    if (pressed > 1) {
      process.stderr.write("\n— saliendo\n");
      process.exit(130);
    }
    process.stderr.write("\n— cancelando el turno…\n");
    ctrl.abort();
    onCancel?.();
    if (!target) {
      process.stderr.write(
        "— ojo: este turno no se puede cancelar desde acá y sigue corriendo en el daemon\n"
      );
      return;
    }
    http
      .post(`/api/projects/${pid}/turns/abort`, target)
      .then((r) => {
        process.stderr.write(
          r?.aborted ? "— turno cancelado\n" : "— el turno ya había terminado\n"
        );
      })
      .catch((e) => {
        process.stderr.write(`— no se pudo cancelar: ${e.message}\n`);
      });
  };

  process.on("SIGINT", onSigint);
  return {
    signal: ctrl.signal,
    interrupted: () => pressed > 0,
    dispose: () => process.off("SIGINT", onSigint),
  };
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
  const interrupt = installInterrupt({
    pid,
    target: execAbortTarget({ channel: CHANNELS.CODE, codeSessionId: sid }),
    onCancel: () => status.clear(),
  });
  status.start();
  let result;
  try {
    result = await http.streamPost(
      `/api/projects/${pid}/code/sessions/${sid}/chat/stream`,
      { prompt, channel: CHANNELS.CODE, cwd: process.cwd(), confirm: false },
      (event) => status.set(labelForEvent(event)),
      { signal: interrupt.signal }
    );
  } catch (e) {
    // Name the session even on failure: the user turn is already stored there,
    // so that is where the half-finished run can be inspected and resumed.
    process.stderr.write(
      `\n— code session ${sid}${created ? " (new)" : ""} | project ${pid} | ${http.baseUrl()}/code\n`
    );
    throw e;
  } finally {
    status.clear();
    interrupt.dispose();
  }

  // A cancelled turn is not a failed one. It has no reply because the person
  // asked for it to stop, and reporting that as an error (exit 1, "ended
  // without a reply") would make Ctrl+C look like a bug.
  if (interrupt.interrupted()) {
    if (result?.text) process.stdout.write(result.text + "\n");
    process.stderr.write(
      `\n— cancelado | code session ${sid} | ${http.baseUrl()}/code\n`
    );
    process.exitCode = 130;
    return;
  }

  // A turn that produced no text is a failed turn, not an empty answer. Saying
  // so beats a blank line and exit 0, which reads as "it worked, silently".
  if (!result?.text) {
    throw new Error(
      `apx exec --code: the turn ended without a reply. Session ${sid} (project ${pid}) has the transcript: ${http.baseUrl()}/code`
    );
  }

  process.stdout.write(result.text + "\n");
  // Always tell the caller where the turn landed — a piped/scripted run needs
  // the id to pass back as --session, and a human needs it to find the session
  // in the panel. stderr keeps stdout clean for scripts.
  process.stderr.write(
    `\n— code session ${sid}${created ? " (new)" : ""} | project ${pid} | ${http.baseUrl()}/code\n`
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
  // the turn is now READABLE afterwards in the web panel (/code) and by the
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
    const interrupt = installInterrupt({
      pid,
      target: execAbortTarget({ channel }),
      onCancel: () => status.clear(),
    });
    status.start();
    let result;
    try {
      result = await http.streamPost(
        `/api/projects/${pid}/super-agent/chat/stream`,
        { ...body, confirm: false },
        (event) => status.set(labelForEvent(event)),
        { signal: interrupt.signal }
      );
    } finally {
      status.clear();
      interrupt.dispose();
    }
    process.stdout.write((result?.text ?? "") + "\n");
    if (interrupt.interrupted()) {
      process.exitCode = 130;
      return;
    }
    if (process.stderr.isTTY || args.flags.verbose) {
      process.stderr.write(
        `\n— ${result?.name || "super-agent"} | model=${result?.trace ? "tools" : "engine"} | in=${result?.usage?.input_tokens || "?"} out=${result?.usage?.output_tokens || "?"}${result?.model ? ` | ${result.model}` : ""}\n`
      );
    }
    return;
  }

  // `-a <slug>` is the one path with no cancel behind it: POST /agents/:slug/exec
  // registers no active turn, so there is nothing for /turns/abort to find.
  // The handler is installed anyway so Ctrl+C SAYS that, instead of killing the
  // CLI and leaving the person to assume the run stopped with it.
  const interrupt = installInterrupt({ pid, target: execAbortTarget({ channel, agentSlug: slug }) });
  let result;
  try {
    result = await http.post(`/api/projects/${pid}/agents/${slug}/exec`, body);
  } finally {
    interrupt.dispose();
  }

  process.stdout.write(result.text + "\n");
  if (process.stderr.isTTY || args.flags.verbose) {
    process.stderr.write(
      `\n— ${result.engine} | in=${result.usage?.input_tokens || "?"} out=${result.usage?.output_tokens || "?"} | conv=${result.conversation.id}\n`
    );
  }
}
