// The owner's terminals: their own shell, in the folder a chat works in, relayed to the panel. A real tty comes from
// pty-bridge.py (Python's pty); without Python the shell runs on plain pipes (commands work, prompts and colors not).
import { type ChildProcess, spawn, spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { StringDecoder } from "node:string_decoder";
import type { TerminalInfo } from "@apx/protocol";
import type { Bus } from "../bus.ts";
import { commandShell } from "../processes.ts";

const BRIDGE = path.join(import.meta.dirname, "pty-bridge.py");
/** What a terminal keeps of its output, to draw it again when the panel opens. */
const BACKLOG = 256 * 1024;
/** Terminals running at once, across every chat. */
const MAX_ALIVE = 12;
/** Output is sent in batches this far apart, not once per read. */
const FLUSH_MS = 12;
/** What the agent is told of a command it suggested, from the end of its output. */
const ENDED_TAIL = 3000;

// biome-ignore lint/suspicious/noControlCharactersInRegex: terminal escape sequences start with ESC
const plain = (s: string) => s.replace(/\x1b\[[0-9;?]*[ -/]*[@-~]|\x1b\][^\x07]*\x07|\r/g, "");

/** A command run in a terminal has ended: what it printed (last part, without colors) and how it ended. */
export type CommandEnded = { info: TerminalInfo; message?: string | undefined; output: string };

type Term = { info: TerminalInfo; child: ChildProcess; backlog: string; pending: string; timer?: NodeJS.Timeout };

/** Python with its pty module, without waking macOS's "install the command line tools" dialog. */
function findPython(): string | undefined {
  if (process.platform === "win32") return undefined;
  if (process.platform === "darwin" && spawnSync("xcode-select", ["-p"], { timeout: 3000 }).status !== 0) {
    // /usr/bin/python3 is only a stub that asks to install the tools; a Homebrew one is real.
    for (const p of ["/opt/homebrew/bin/python3", "/usr/local/bin/python3"])
      if (spawnSync(p, ["-c", "import pty"], { timeout: 3000 }).status === 0) return p;
    return undefined;
  }
  return spawnSync("python3", ["-c", "import pty"], { timeout: 3000 }).status === 0 ? "python3" : undefined;
}

/** The owner's environment, without APX's own settings (its token, how the core was started). */
function shellEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const [k, v] of Object.entries(process.env))
    if (!k.startsWith("APX_") && k !== "ELECTRON_RUN_AS_NODE" && k !== "NODE_OPTIONS") env[k] = v;
  return { ...env, TERM: "xterm-256color", COLORTERM: "truecolor" };
}

const shellOf = () =>
  process.platform === "win32" ? (process.env.COMSPEC ?? "powershell.exe") : (process.env.SHELL ?? "/bin/sh");

/** The shell's arguments: an open (login, interactive) shell, or one that runs only `command` and ends. */
function shellArgs(tty: boolean, command?: string): string[] {
  if (process.platform === "win32") return [];
  if (command) return ["-l", "-c", command];
  return tty ? ["-l"] : ["-i"];
}

export type Terminals = ReturnType<typeof createTerminals>;

export function createTerminals(deps: { bus: Bus; commandEnded?: (e: CommandEnded) => void }) {
  const terms = new Map<string, Term>();
  let python: string | undefined | null = null;
  const pythonPath = () => {
    if (python === null) python = findPython();
    return python;
  };

  const flush = (t: Term) => {
    t.timer = undefined;
    if (!t.pending) return;
    const data = t.pending;
    t.pending = "";
    deps.bus.emit({ type: "terminal.output", terminal: t.info.id, data });
  };
  const get = (id: string) => {
    const t = terms.get(id);
    if (!t) throw new Error(`no terminal ${id}`);
    return t;
  };

  const list = (threadId: string): TerminalInfo[] =>
    [...terms.values()].filter((t) => t.info.thread_id === threadId).map((t) => t.info);

  return {
    list,
    open(
      threadId: string,
      cwd: string,
      size: { cols: number; rows: number },
      run?: { command: string; message?: string | undefined },
    ): TerminalInfo {
      if ([...terms.values()].filter((t) => t.info.alive).length >= MAX_ALIVE)
        throw new Error(`${MAX_ALIVE} terminals are open: close one first`);
      // A command block is written for sh: on Windows it runs where agents' commands do, not in cmd.
      const block = run && process.platform === "win32" ? commandShell() : undefined;
      const shell = block?.file ?? shellOf();
      const py = pythonPath();
      const args = block && run ? block.args(run.command) : shellArgs(Boolean(py), run?.command);
      const child = py
        ? spawn(py, [BRIDGE, String(size.rows), String(size.cols), shell, ...args], {
            cwd,
            env: shellEnv(),
            stdio: ["pipe", "pipe", "pipe", "pipe"],
          })
        : spawn(shell, args, { cwd, env: shellEnv(), stdio: "pipe" });
      const n = list(threadId).length + 1;
      const info: TerminalInfo = {
        id: `term_${randomUUID().slice(0, 12)}`,
        thread_id: threadId,
        title: run
          ? run.command.split("\n")[0]?.slice(0, 40) || "command"
          : `${path.basename(shell).replace(/\.exe$/i, "")} ${n}`,
        cwd,
        alive: true,
        tty: Boolean(py),
        ...(run ? { command: run.command } : {}),
        started_at: new Date().toISOString(),
      };
      const t: Term = { info, child, backlog: "", pending: "" };
      terms.set(info.id, t);
      const decoder = new StringDecoder("utf8");
      const take = (chunk: Buffer) => {
        const text = decoder.write(chunk);
        if (!text) return;
        t.backlog = (t.backlog + text).slice(-BACKLOG);
        t.pending += text;
        t.timer ??= setTimeout(() => flush(t), FLUSH_MS);
      };
      child.stdout?.on("data", take);
      child.stderr?.on("data", take);
      child.on("error", (e) => take(Buffer.from(`\r\napx: ${e.message}\r\n`)));
      child.on("exit", (code) => {
        clearTimeout(t.timer);
        flush(t);
        t.info = { ...t.info, alive: false, ...(code == null ? {} : { exit_code: code }) };
        deps.bus.emit({ type: "terminal.exited", terminal: info.id, ...(code == null ? {} : { exit_code: code }) });
        // Closed by the owner before it ended: nobody waits for how it went.
        if (run && terms.has(info.id))
          deps.commandEnded?.({ info: t.info, message: run.message, output: plain(t.backlog).slice(-ENDED_TAIL) });
      });
      return info;
    },
    attach(id: string): { terminal: TerminalInfo; backlog: string } {
      const t = get(id);
      return { terminal: t.info, backlog: t.backlog };
    },
    input(id: string, data: string): void {
      const t = get(id);
      // Without a tty nobody turns Enter into a newline for the shell.
      if (t.info.alive) t.child.stdin?.write(t.info.tty ? data : data.replace(/\r/g, "\n"));
    },
    resize(id: string, size: { cols: number; rows: number }): void {
      const t = get(id);
      const control = t.child.stdio[3];
      if (t.info.alive && control && "write" in control) control.write(`${size.rows} ${size.cols}\n`);
    },
    close(id: string): void {
      const t = get(id);
      if (t.info.alive) t.child.kill("SIGHUP");
      clearTimeout(t.timer);
      terms.delete(id);
    },
    /** Every shell ends with the core. */
    closeAll(): void {
      for (const t of terms.values()) if (t.info.alive) t.child.kill("SIGHUP");
      terms.clear();
    },
  };
}
