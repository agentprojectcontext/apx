/** A child process (Claude Code, Codex, a shell command) gets the environment minus APX's own secrets. */
export function childEnv(): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) if (v !== undefined && !k.startsWith("APX_")) env[k] = v;
  return env;
}
