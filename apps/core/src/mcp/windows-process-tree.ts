import { execFile } from "node:child_process";
import { promisify } from "node:util";

const exec = promisify(execFile);

/** A .cmd server is a process tree; closing its shell alone leaves its server holding files. */
async function stopWindowsTree(pid: number): Promise<void> {
  try {
    await exec("taskkill.exe", ["/pid", String(pid), "/t", "/f"], { timeout: 5_000, windowsHide: true });
  } catch (error) {
    try {
      process.kill(pid, 0);
    } catch (probe) {
      if ((probe as NodeJS.ErrnoException).code === "ESRCH") return;
      throw probe;
    }
    throw error;
  }
}

export function closeWindowsTree(
  transport: { readonly pid: number | null; close(): Promise<void> },
  stop: (pid: number) => Promise<void> = stopWindowsTree,
): void {
  const close = transport.close.bind(transport);
  let closing: Promise<void> | undefined;
  transport.close = () => {
    if (!closing) {
      const attempt = (async () => {
        if (transport.pid !== null) await stop(transport.pid);
        await close();
      })();
      closing = attempt;
      void attempt.catch(() => {
        if (closing === attempt) closing = undefined;
      });
    }
    return closing;
  };
}
