import { type ChildProcess, execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";

const exec = promisify(execFile);

/** A .cmd server is a process tree; closing its shell alone leaves its server holding files. */
async function stopWindowsTree(pid: number): Promise<void> {
  const root = process.env.SystemRoot;
  if (!root) throw new Error("Windows system directory is unavailable");
  await exec(path.join(root, "System32", "taskkill.exe"), ["/pid", String(pid), "/t", "/f"], {
    timeout: 5_000,
    windowsHide: true,
  });
}

type Root = Pick<ChildProcess, "pid" | "exitCode" | "signalCode">;
type Transport = { readonly pid: number | null; close(): Promise<void> };

export function closeWindowsTree(
  transport: Transport,
  options: {
    root?: () => Root | undefined;
    stop?: (pid: number) => Promise<void>;
    grace?: () => Promise<void>;
  } = {},
): void {
  const close = transport.close.bind(transport);
  // The SDK clears its public pid as soon as close starts; retain its child handle to check whether the root exited.
  const root = options.root ?? (() => (transport as unknown as { _process?: ChildProcess })._process);
  const stop = options.stop ?? stopWindowsTree;
  const grace = options.grace ?? (() => new Promise<void>((resolve) => setTimeout(resolve, 500).unref()));
  let closing: Promise<void> | undefined;
  let base: Promise<void> | undefined;
  let child: Root | undefined;
  transport.close = () => {
    if (!closing) {
      const attempt = (async () => {
        child ??= root();
        if (transport.pid !== null && !child) throw new Error("Cannot safely identify the MCP process");
        base ??= close();
        const finished = await Promise.race([base.then(() => true), grace().then(() => false)]);
        if (!finished && child?.pid && child.exitCode === null && child.signalCode === null) await stop(child.pid);
        await base;
      })();
      closing = attempt;
      void attempt.catch(() => {
        if (closing === attempt) closing = undefined;
      });
    }
    return closing;
  };
}
