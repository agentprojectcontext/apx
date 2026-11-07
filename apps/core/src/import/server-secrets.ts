// Credentials written into an MCP server's definition, found by the name they are given and by what they look like:
// an importer never copies one (rule 11), and the owner's own MCP card never shows one.
import { looksSecret } from "../domain/memories.ts";
import { keyLike } from "../log.ts";

export type FoundServer = {
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  url?: string;
  headers?: Record<string, string>;
};

/** Where a server holds a credential: an env or header key, a command argument (its flag), or its address. */
export type ServerSecret = { at: "env" | "header" | "arg" | "url"; key: string };

const SECRET_REF = /secret:\/\/[a-zA-Z0-9_.-]+/g;
const SECRET_KEY = /key|token|secret|pass|pwd|auth|credential|cookie/i;

/** A URL carrying a credential: a password before the host, or a query value named like a key or shaped like one. */
function urlSecret(v: string): boolean {
  const text = v.trim();
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(text)) return false;
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    return false;
  }
  if (url.password) return true;
  return [...url.searchParams].some(([k, x]) => !!x && (SECRET_KEY.test(k) || keyLike(x)));
}

/** A value written as a credential: shaped like a key, a URL holding one, or a reference to the owner's shell. */
const secretValue = (v: string) => !!v && (v.includes("${") || keyLike(v) || looksSecret(v) || urlSecret(v));

/** An argument that is a credential on its own, whatever flag comes before it (a package name is never one). */
const secretArg = (v: string) => v.includes("${") || looksSecret(v) || urlSecret(v);

/** The credentials in a command's arguments, by flag (`--token X`, `--api-key=X`) or by place when they have none. */
function argSecrets(args: string[]): ServerSecret[] {
  const out: ServerSecret[] = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i] ?? "";
    const next = args[i + 1];
    const inline = /^(--?[^=\s]+)=(.*)$/s.exec(a);
    if (inline?.[1] && inline[2] && (SECRET_KEY.test(inline[1]) || secretArg(inline[2])))
      out.push({ at: "arg", key: inline[1] });
    else if (/^--?[A-Za-z]/.test(a) && SECRET_KEY.test(a) && next && !next.startsWith("-")) {
      out.push({ at: "arg", key: a });
      i++;
    } else if (secretArg(a)) out.push({ at: "arg", key: `argument ${i + 1}` });
  }
  return out;
}

/** Every credential written into a server's definition (a secret:// reference to one the owner saved is not one). */
export function serverSecrets(s: FoundServer): ServerSecret[] {
  const bare = (v: string) => v.replace(SECRET_REF, "").trim();
  const env = Object.entries(s.env ?? {}).filter(([k, v]) => bare(v) && (SECRET_KEY.test(k) || secretValue(v)));
  const headers = Object.entries(s.headers ?? {}).filter(
    ([k, v]) => bare(v) && (SECRET_KEY.test(k) || bare(v).length >= 24 || secretValue(v)),
  );
  return [
    ...env.map(([key]) => ({ at: "env" as const, key })),
    ...headers.map(([key]) => ({ at: "header" as const, key })),
    ...argSecrets(s.args ?? []),
    ...(s.url && urlSecret(s.url) ? [{ at: "url" as const, key: "url" }] : []),
  ];
}
