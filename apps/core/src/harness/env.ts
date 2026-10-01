/** An agent CLI (Claude Code, Codex, an ACP agent) gets the environment minus APX's own secrets. */
export function childEnv(): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) if (v !== undefined && !k.startsWith("APX_")) env[k] = v;
  return env;
}

/** Variable names that usually hold credentials. */
const SECRET_NAME = /(KEY|TOKEN|SECRET|PASSW|CREDENTIAL|AUTH|COOKIE|SESSION|PRIVATE)/i;

/**
 * A command an agent runs gets less: no credentials at all. Agent CLIs may need their own keys; a shell command
 * started by a model must not be able to print them.
 */
export function commandEnv(): Record<string, string> {
  const env = childEnv();
  for (const k of Object.keys(env)) if (SECRET_NAME.test(k)) delete env[k];
  return env;
}
