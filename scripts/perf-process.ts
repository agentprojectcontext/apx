import path from "node:path";

/** Launch Node by its absolute path without exposing adjacent global agent CLIs to the measured core. */
export function performanceProcess(executable = process.execPath): { command: string; searchPath: string } {
  const system = process.env.SystemRoot ?? "C:\\Windows";
  const directories = process.platform === "win32" ? [path.join(system, "System32"), system] : ["/usr/bin", "/bin"];
  return { command: executable, searchPath: directories.join(path.delimiter) };
}
