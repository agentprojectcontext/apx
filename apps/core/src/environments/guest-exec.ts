import { type ChildProcess, execFile } from "node:child_process";
import { unavailable } from "../errors.ts";

export function stopGuestProcesses(children: Iterable<ChildProcess>) {
  return Promise.all(
    [...children].map(
      (child) =>
        new Promise<void>((resolve) => {
          if (child.exitCode !== null || child.signalCode !== null) {
            resolve();
            return;
          }
          const deadline = setTimeout(() => child.kill("SIGKILL"), 1000);
          child.once("close", () => {
            clearTimeout(deadline);
            resolve();
          });
          child.kill();
        }),
    ),
  );
}

export function guestExecutor(binary: () => string, env: NodeJS.ProcessEnv) {
  const children = new Set<ChildProcess>();
  return {
    exec: (args: string[], timeout = 10_000): Promise<string> =>
      new Promise((resolve, reject) => {
        const child = execFile(
          binary(),
          args,
          { env, timeout, maxBuffer: 512 * 1024, windowsHide: true },
          (error, stdout) => {
            children.delete(child);
            if (error) reject(unavailable("VM command failed; no command was run on the host"));
            else resolve(stdout);
          },
        );
        children.add(child);
      }),
    async close() {
      const stopped = stopGuestProcesses(children);
      children.clear();
      await stopped;
    },
  };
}
