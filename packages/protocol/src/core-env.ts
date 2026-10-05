// <APX home>/core.env: how the core is exposed (host, port, token, public URL), shared by the core, the terminal and
// the desktop app. Pure text in, text out: each side does its own file access.

export const CORE_ENV_FILE = "core.env";

/** The only keys the file may set; anything else in it is ignored. */
export const CORE_ENV_KEYS = ["APX_HOST", "APX_PORT", "APX_TOKEN", "APX_PUBLIC_URL", "APX_ALLOWED_ORIGINS"] as const;
export type CoreEnvKey = (typeof CORE_ENV_KEYS)[number];

const HEADER = "# APX core settings (KEY=VALUE). Written by `apx expose`; the process environment wins over this file.";

export function parseCoreEnv(text: string): Record<string, string> {
  const vars: Record<string, string> = {};
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (value.length >= 2 && value.startsWith('"') && value.endsWith('"')) value = value.slice(1, -1);
    vars[key] = value;
  }
  return vars;
}

/** Known keys first in their fixed order, then any others alphabetically, so rewrites diff cleanly. */
export function serializeCoreEnv(vars: Record<string, string>): string {
  const known: readonly string[] = CORE_ENV_KEYS;
  const keys = [
    ...known.filter((k) => k in vars),
    ...Object.keys(vars)
      .filter((k) => !known.includes(k))
      .sort(),
  ];
  return `${[HEADER, ...keys.map((k) => `${k}=${vars[k]}`)].join("\n")}\n`;
}

/** Only the keys the core accepts from the file. */
export function coreEnvDefaults(vars: Record<string, string>): Partial<Record<CoreEnvKey, string>> {
  const out: Partial<Record<CoreEnvKey, string>> = {};
  for (const k of CORE_ENV_KEYS) if (vars[k] !== undefined && vars[k] !== "") out[k] = vars[k];
  return out;
}
