// What keeps secret values out of an export: every stored value found in the file becomes its `secret://` name, then
// the redaction durable data gets (credential fields, key shapes), then keys typed where a command or address takes
// them become references. See DECISIONS.md#d-192
import type { InstanceFile, InstanceMcp, InstanceRoutine } from "@apx/protocol";
import type { FlowDraftGraph } from "@apx/protocol/flow-graph";
import { looksSecret } from "../domain/memories.ts";
import { keyLike, redactedJson } from "../log.ts";
import { type Secrets, splitSecretName } from "../secrets.ts";

/** Values shorter than this are not looked for: a few letters would match ordinary words. */
const MIN_LENGTH = 6;

export type KnownSecret = { ref: string; value: string };

/** The values this install keeps, longest first (so a value inside another is replaced after it). */
export function knownSecrets(secrets: Pick<Secrets, "list" | "resolve">): KnownSecret[] {
  return secrets
    .list()
    .flatMap(({ name }) => {
      const value = secrets.resolve(`secret://${name}`);
      return value && value.length >= MIN_LENGTH ? [{ ref: `secret://${splitSecretName(name).name}`, value }] : [];
    })
    .sort((a, b) => b.value.length - a.value.length);
}

/** The value as JSON-safe data with no secret value left in it. */
export function scrubbed<T>(value: T, known: readonly KnownSecret[]): T {
  let text = JSON.stringify(value);
  for (const s of known) {
    // As the value reads inside a JSON string (quotes and backslashes escaped).
    const inJson = JSON.stringify(s.value).slice(1, -1);
    if (text.includes(inJson)) text = text.split(inJson).join(s.ref);
  }
  return JSON.parse(redactedJson(JSON.parse(text))) as T;
}

/** Whether any stored value still reads in the text: an export that would carry one is never handed out. */
export const carriesSecret = (text: string, known: readonly KnownSecret[]) =>
  known.some((s) => text.includes(JSON.stringify(s.value).slice(1, -1)));

/** Every `secret://` name the data refers to. */
export function secretRefs(value: unknown): string[] {
  const names = new Set<string>();
  // A "/" only after a project's prefix (`~p/name`): in an address it is the next part of the path.
  for (const m of JSON.stringify(value).matchAll(/secret:\/\/((?:~[A-Za-z0-9_.-]+\/)?[A-Za-z0-9_.:-]{1,200})/g))
    names.add(m[1] as string);
  return [...names].sort();
}

/** A flag, variable, header or query name whose value is a key: --api-key, --token, API_KEY, X-Api-Key, password. */
const KEY_NAME = /(?:^|[_-])(?:api[_-]?key|apikey|key|token|secret|password|passwd|pwd|credentials?)$/i;
const keyName = (name: string) => KEY_NAME.test(name.replace(/^-+/, "")) || /^authorization$/i.test(name);
/** Left as it is: empty, a reference, or a variable the command or the Flow fills in. */
const carried = (v: string) => !v || /secret:\/\/|^env:|\$|\{\{/.test(v);
/** Shaped like a key wherever it sits: the redaction caught it, or it reads as one of the known shapes. */
const keyShaped = (v: string) => v.includes("[redacted]") || looksSecret(v);

/** A reference named after where the key sat: `secret://<owner>_<place>`. */
type KeyRef = (place: string) => string;
const keyRef =
  (owner: string): KeyRef =>
  (place) =>
    `secret://${`${owner}_${place}`
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "")}`;

/** Arguments with each typed key as a reference: after a key's flag, as `name=value`, or by its shape. */
function argsWithoutKeys(args: readonly string[], ref: KeyRef): string[] {
  return args.map((a, i) => {
    if (carried(a)) return a;
    const assigned = /^(-{0,2}[A-Za-z_][\w.-]*)=(.*)$/s.exec(a);
    if (assigned) {
      const [, name = "", value = ""] = assigned;
      return !carried(value) && (keyName(name) || keyShaped(value)) ? `${name}=${ref(name)}` : a;
    }
    const flag = args[i - 1] ?? "";
    if (flag.startsWith("-") && !flag.includes("=") && keyName(flag) && !a.startsWith("-")) return ref(flag);
    return keyShaped(a) ? ref("key") : a;
  });
}

/** A command line with each typed key as a reference: after a key's flag, or given to a key's variable. */
function commandWithoutKeys(command: string, ref: KeyRef): string {
  const value = String.raw`("[^"]*"|'[^']*'|[^\s"'|;&<>]+)`;
  const swap = (m: string, lead: string, name: string, sep: string, v: string) =>
    keyName(name) && !v.startsWith("-") && !carried(v.replace(/^["']|["']$/g, ""))
      ? `${lead}${name}${sep}${ref(name)}`
      : m;
  return command
    .replace(new RegExp(String.raw`(^|\s)(-{1,2}[A-Za-z][\w-]*)(=|\s+)${value}`, "g"), swap)
    .replace(new RegExp(String.raw`(^|\s)([A-Za-z_]\w*)(=)${value}`, "g"), swap);
}

/** An address with the keys some carry in its path or query as references. */
function urlWithoutKeys(url: string, ref: KeyRef): string {
  const m = /^([a-z][a-z0-9+.-]*:\/\/[^/?#]*)([^?#]*)(\?[^#]*)?(#.*)?$/i.exec(url);
  if (!m) return url;
  const [, origin = "", path = "", query = "", hash = ""] = m;
  let n = 0;
  const parts = path
    .split("/")
    .map((p) => (!carried(p) && (keyShaped(p) || keyLike(p)) ? ref(`url_key${++n > 1 ? n : ""}`) : p));
  const params = query
    .slice(1)
    .split("&")
    .map((pair) => {
      const at = pair.indexOf("=");
      const [name, value] = at < 0 ? [pair, ""] : [pair.slice(0, at), pair.slice(at + 1)];
      return at >= 0 && !carried(value) && (keyName(name) || keyShaped(value) || keyLike(value))
        ? `${name}=${ref(name)}`
        : pair;
    });
  return `${origin}${parts.join("/")}${query ? `?${params.join("&")}` : ""}${hash}`;
}

/** A header's or a variable's value: a key's name takes its last word ("Bearer …") as a reference. */
function namedWithoutKey(pair: { name: string; value: string }, ref: KeyRef) {
  if (carried(pair.value) || !(keyName(pair.name) || keyShaped(pair.value))) return pair;
  const scheme = /^(\w+\s+)\S+$/.exec(pair.value)?.[1] ?? "";
  return { ...pair, value: `${scheme}${ref(pair.name)}` };
}

export const mcpWithoutKeys = (m: InstanceMcp): InstanceMcp => {
  const ref = keyRef(m.name);
  return { ...m, args: argsWithoutKeys(m.args, ref), ...(m.url ? { url: urlWithoutKeys(m.url, ref) } : {}) };
};

export const routineWithoutKeys = (r: InstanceRoutine): InstanceRoutine => {
  const ref = keyRef(r.name);
  return {
    ...r,
    ...(r.pre_command ? { pre_command: commandWithoutKeys(r.pre_command, ref) } : {}),
    ...(r.post_command ? { post_command: commandWithoutKeys(r.post_command, ref) } : {}),
  };
};

export function graphWithoutKeys(graph: FlowDraftGraph, flow: string): FlowDraftGraph {
  const ref = keyRef(flow);
  const nodes = graph.nodes.map((n) => {
    if (n.kind === "http")
      return { ...n, url: urlWithoutKeys(n.url, ref), headers: n.headers.map((h) => namedWithoutKey(h, ref)) };
    if (n.kind === "cmd")
      return { ...n, command: commandWithoutKeys(n.command, ref), env: n.env.map((e) => namedWithoutKey(e, ref)) };
    return n;
  });
  return { ...graph, nodes } as FlowDraftGraph;
}

/**
 * Keys typed as text where no stored value matched (a server's arguments or address, a routine's command, a Flow's
 * step): each becomes a reference named after its place, which the preview asks for.
 */
export const withoutTypedKeys = (file: InstanceFile): InstanceFile => ({
  ...file,
  mcps: file.mcps.map(mcpWithoutKeys),
  routines: file.routines.map(routineWithoutKeys),
  flows: file.flows.map((f) => (f.graph ? { ...f, graph: graphWithoutKeys(f.graph, f.definition.name) } : f)),
});
