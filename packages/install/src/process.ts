import { spawn } from "node:child_process";

export type ProcessRunner = (
  command: string,
  args: string[],
  options: { signal: AbortSignal; detached?: boolean; env: NodeJS.ProcessEnv },
) => Promise<void>;

export const runProcess: ProcessRunner = (command, args, options) =>
  new Promise((resolve, reject) => {
    options.signal.throwIfAborted();
    const child = spawn(command, args, {
      env: options.env,
      ...(options.detached ? {} : { signal: options.signal }),
      detached: options.detached === true,
      stdio: "ignore",
      windowsHide: true,
    });
    child.once("error", reject);
    if (options.detached) {
      let timer: ReturnType<typeof setTimeout> | undefined;
      const done = (error?: Error) => {
        if (timer) clearTimeout(timer);
        options.signal.removeEventListener("abort", abort);
        child.removeListener("exit", exited);
        child.unref();
        if (error) reject(error);
        else resolve();
      };
      const abort = () => done(new Error("Desktop launch interrupted"));
      const exited = (code: number | null, signal: NodeJS.Signals | null) =>
        done(code === 0 ? undefined : new Error(`Desktop failed to start (${signal ?? code})`));
      child.once("exit", exited);
      options.signal.addEventListener("abort", abort, { once: true });
      child.once("spawn", () => {
        timer = setTimeout(() => done(), 1500);
      });
    } else
      child.once("exit", (code, signal) =>
        code === 0 ? resolve() : reject(new Error(`${command} failed (${signal ?? code})`)),
      );
  });
