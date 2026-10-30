import { spawn } from "node:child_process";

export type LimaRun = (
  args: string[],
  options?: { input?: string | Buffer; signal?: AbortSignal; timeout?: number },
) => Promise<string>;

/** No shell expansion; provisioning and guest input use only this private Lima home. */
export function limaProcess(binary: () => string, env: NodeJS.ProcessEnv): LimaRun {
  return (args, options = {}) =>
    new Promise((resolve, reject) => {
      const child = spawn(binary(), args, {
        env,
        signal: options.signal,
        stdio: ["pipe", "pipe", "pipe"],
        windowsHide: true,
      });
      let output = "";
      let error = "";
      const deadline = setTimeout(() => child.kill("SIGKILL"), options.timeout ?? 15_000);
      child.stdout.on("data", (data: Buffer) => {
        output = (output + data.toString()).slice(-512 * 1024);
      });
      child.stderr.on("data", (data: Buffer) => {
        error = (error + data.toString()).slice(-2000);
      });
      child.stdin.on("error", () => {});
      child.stdin.end(options.input);
      child.once("error", (failure) => {
        clearTimeout(deadline);
        reject(failure);
      });
      child.once("close", (code) => {
        clearTimeout(deadline);
        if (code === 0) resolve(output);
        else reject(new Error(`Computer command failed (${code ?? "interrupted"}): ${error}`));
      });
    });
}
