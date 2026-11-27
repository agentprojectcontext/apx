import { execFile } from "node:child_process";
import { readdir, readFile } from "node:fs/promises";
import { promisify } from "node:util";

const exec = promisify(execFile);

/** A process as the system lists it; `start` tells a process from a later one that took its pid. */
export type Proc = { pid: number; ppid: number; start: string };

async function fromProc(): Promise<Proc[]> {
  const out: Proc[] = [];
  for (const name of await readdir("/proc")) {
    if (!/^\d+$/.test(name)) continue;
    const stat = await readFile(`/proc/${name}/stat`, "utf8").catch(() => "");
    // The command name may hold spaces or parentheses: fields are counted after its last ")".
    const fields = stat.slice(stat.lastIndexOf(")") + 2).split(" ");
    if (fields.length > 19) out.push({ pid: Number(name), ppid: Number(fields[1]), start: fields[19] ?? "" });
  }
  return out;
}

async function fromPs(): Promise<Proc[]> {
  const { stdout } = await exec("ps", ["-A", "-o", "pid=,ppid=,lstart="], { timeout: 5_000 });
  return stdout.split("\n").flatMap((line) => {
    const m = /^\s*(\d+)\s+(\d+)\s+(.+?)\s*$/.exec(line);
    return m ? [{ pid: Number(m[1]), ppid: Number(m[2]), start: m[3] ?? "" }] : [];
  });
}

/** Every process on this machine, or none when the system will not say. */
async function processTable(): Promise<Proc[]> {
  try {
    return process.platform === "linux" ? await fromProc() : await fromPs();
  } catch {
    return [];
  }
}

/** The processes started, directly or not, by `root`. */
function below(root: number, table: Proc[]): Proc[] {
  const kids = new Map<number, Proc[]>();
  for (const p of table) kids.set(p.ppid, [...(kids.get(p.ppid) ?? []), p]);
  const found: Proc[] = [];
  const queue = [root];
  for (let pid = queue.shift(); pid !== undefined; pid = queue.shift())
    for (const kid of kids.get(pid) ?? []) {
      if (found.some((p) => p.pid === kid.pid)) continue;
      found.push(kid);
      queue.push(kid.pid);
    }
  return found;
}

type Transport = { readonly pid: number | null; close(): Promise<void> };

/**
 * A server started through npx or a shell is a process tree, and stopping its root leaves the server running (an
 * mcp-remote waiting on a sign-in keeps its return port): once the root is closed, what it started is stopped too.
 */
export function closePosixTree(
  transport: Transport,
  options: {
    table?: () => Promise<Proc[]>;
    kill?: (pid: number, signal: NodeJS.Signals) => void;
    grace?: () => Promise<void>;
  } = {},
): void {
  const close = transport.close.bind(transport);
  const table = options.table ?? processTable;
  const kill = options.kill ?? ((pid, signal) => process.kill(pid, signal));
  const grace = options.grace ?? (() => new Promise<void>((resolve) => setTimeout(resolve, 1_000).unref()));
  const send = async (tree: Proc[], signal: NodeJS.Signals) => {
    const now = await table();
    const still = tree.filter((p) => now.some((n) => n.pid === p.pid && n.start === p.start));
    for (const p of still)
      try {
        kill(p.pid, signal);
      } catch {
        // Gone between the listing and the signal.
      }
    return still;
  };
  let closing: Promise<void> | undefined;
  transport.close = () => {
    closing ??= (async () => {
      const root = transport.pid;
      const tree = root ? below(root, await table()) : [];
      try {
        await close();
      } finally {
        if (tree.length && (await send(tree, "SIGTERM")).length) {
          await grace();
          await send(tree, "SIGKILL");
        }
      }
    })();
    return closing;
  };
}
