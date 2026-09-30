// Minimal structured logger (JSON lines on stderr). Swappable for pino later without touching callers.
export type Log = {
  info(fields: Record<string, unknown>, msg: string): void;
  warn(fields: Record<string, unknown>, msg: string): void;
  error(fields: Record<string, unknown>, msg: string): void;
};

export function createLog(scope: string, quiet = false): Log {
  const write = (level: string) => (fields: Record<string, unknown>, msg: string) => {
    if (quiet) return;
    process.stderr.write(`${JSON.stringify({ t: new Date().toISOString(), level, scope, msg, ...fields })}\n`);
  };
  return { info: write("info"), warn: write("warn"), error: write("error") };
}
