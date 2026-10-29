// What a drawing does outside APX: where its notify steps send as the owner and which hosts its HTTP steps call.
// Publishing a revision is the owner's approval of exactly that list (DECISIONS.md#d-169), so the destinations are
// fixed fields of the revision, checked against the owner's own channels, contacts and secrets.
import { createHash } from "node:crypto";
import type { FlowGraph, FlowGraphIssue, FlowNode } from "../../../packages/protocol/src/flow-graph.ts";
import type { ChannelConfig } from "./channels/types.ts";
import { flowVarIndex } from "./domain/flow-graph-validate.ts";
import { flowHttpUrlProblem } from "./domain/flow-http-url.ts";
import { flowSecretVars, SECRET_REF, secretKeyText, secretRefs } from "./domain/flow-secret-vars.ts";
import { OWNER_ID } from "./domain/persons.ts";
import type { Store } from "./domain/store.ts";
import { flowDatabaseFile, flowFolder } from "./flow-work-steps.ts";
import { redactedJson } from "./log.ts";

type Notify = Extract<FlowNode, { kind: "notify" }>;
type Http = Extract<FlowNode, { kind: "http" }>;
type Cmd = Extract<FlowNode, { kind: "cmd" }>;

/** What checks a drawing's outward steps beyond its shape. */
export type FlowOutside = {
  /** Whether a `secret://name` resolves for the Flow's project. */
  secret(ref: string, project: string): boolean;
  /** A test's exact `host:port` destinations that are not public (empty in a real core). */
  allowHttp?: readonly string[] | undefined;
  /** APX's folder, for where a project's commands run and its databases are. */
  home?: string | undefined;
};

export { SECRET_REF };

/** Header names that carry a credential: their value must come from Secrets. */
const CREDENTIAL_HEADER = /^(authorization|cookie|x-api-key|api-key|apikey)$|token|secret|password|key$/i;

const channels = (store: Store): ChannelConfig[] => store.settings.read("channels");

/** The channel and person or room a notify step sends to, as they are now; undefined when one is gone. */
export function notifyDestination(store: Store, node: Notify) {
  const channel = channels(store).find((c) => c.id === node.channel);
  if (!channel?.enabled) return undefined;
  if (node.to.kind === "room") {
    const room = channel.rooms?.rooms.find((r) => r.id === (node.to as { room: string }).room);
    return room ? { channel, to: `#${room.name || room.id}`, owner: false, room } : undefined;
  }
  const person = store.persons.get(node.to.person);
  if (!person || person.role === "blocked") return undefined;
  if (!person.addresses.some((a) => a.channel === channel.id)) return undefined;
  return { channel, to: person.name, owner: person.id === OWNER_ID, person };
}

function httpHost(node: Http): string {
  try {
    return new URL(node.url).host;
  } catch {
    return node.url;
  }
}

/** What a command or a write is, as the owner approves it: any change to it is a new approval. */
const digest = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex").slice(0, 32);

/**
 * The sends, calls, commands and database writes a drawing makes, and the keys the owner approves by publishing it.
 * `folder` is where its commands run and its databases are, as the panel shows it; `place` the same folder, real: it is
 * part of what is approved, so the same command in another folder asks again.
 */
export function flowOutward(store: Store, graph: FlowGraph, folder = "", place = "") {
  const sends: { node: string; channel: string; type: string; to: string; owner: boolean }[] = [];
  const calls: { node: string; method: string; host: string; secrets: string[] }[] = [];
  const commands: { node: string; command: string; folder: string; secrets: string[] }[] = [];
  const writes: { node: string; database: string }[] = [];
  // Secrets are read in an HTTP step's headers and a command's environment, nowhere else; a variable holding one
  // counts where it is used, as the reference it holds.
  const vars = flowVarIndex(graph);
  const secretVars = flowSecretVars(graph);
  const secretsOf = (n: Http | Cmd) => [
    ...new Set(
      (n.kind === "http" ? n.headers : n.env).flatMap((h) =>
        secretRefs(h.value, vars, secretVars).map((r) => r.slice(9)),
      ),
    ),
  ];
  const keyed = (list: { name: string; value: string }[]) =>
    list.map((e) => ({ ...e, value: secretKeyText(e.value, vars, secretVars) }));
  for (const node of graph.nodes) {
    if (node.kind === "notify") {
      const d = notifyDestination(store, node);
      sends.push({
        node: node.id,
        channel: d?.channel.label ?? node.channel,
        type: d?.channel.type ?? "",
        to: d?.to ?? "?",
        owner: d?.owner ?? false,
      });
    }
    if (node.kind === "http")
      calls.push({ node: node.id, method: node.method, host: httpHost(node), secrets: secretsOf(node) });
    if (node.kind === "cmd") commands.push({ node: node.id, command: node.command, folder, secrets: secretsOf(node) });
    if (node.kind === "sql" && node.mode === "write") writes.push({ node: node.id, database: node.database });
  }
  const keys = [
    ...graph.nodes.flatMap((n) =>
      n.kind === "notify"
        ? [`send:${n.channel}:${n.to.kind === "room" ? `room:${n.to.room}` : `contact:${n.to.person}`}`]
        : n.kind === "http"
          ? // Which secrets go to which address is part of what the owner allows.
            [`call:${n.method}:${n.url}`, ...secretsOf(n).map((s) => `secret:${s}:${n.url}`)]
          : n.kind === "cmd"
            ? [`cmd:${digest([place, n.command, keyed(n.env), n.stdin, n.continueOnError])}`]
            : n.kind === "sql" && n.mode === "write"
              ? [`write:${digest([place, n.database, n.query, n.params])}`]
              : [],
    ),
  ];
  return { keys: [...new Set(keys)].sort(), sends, calls, commands, writes };
}

/** Issues only the owner's own setup can raise: a destination or a secret that is not there, a key typed in. */
export function flowOutwardIssues(
  store: Store,
  project: string,
  graph: FlowGraph,
  outside: FlowOutside | undefined,
): FlowGraphIssue[] {
  const issues: FlowGraphIssue[] = [];
  const add = (code: string, node: string, message: string) => issues.push({ code, node, message });
  const folder = graph.nodes.some((n) => n.kind === "cmd" || n.kind === "sql")
    ? flowFolder(store, outside?.home, project)
    : undefined;
  const vars = flowVarIndex(graph);
  const secretVars = flowSecretVars(graph);
  for (const node of graph.nodes) {
    if ((node.kind === "cmd" || node.kind === "sql") && !folder)
      add("folder_unavailable", node.id, "The project's folder is not on this computer");
    else if (node.kind === "sql" && folder && !flowDatabaseFile(folder, outside?.home, node))
      add(
        "database_unavailable",
        node.id,
        node.mode === "read" ? "There is no such database in the project" : "Its folder is not in the project",
      );
    if (node.kind === "notify" && !notifyDestination(store, node))
      add("destination_unavailable", node.id, "Pick a channel and someone on it, or one of its rooms");
    if (node.kind === "cmd")
      for (const e of node.env) {
        const literal = e.value.replace(SECRET_REF, "");
        if (redactedJson({ v: literal }) !== JSON.stringify({ v: literal }))
          add("credential_literal", node.id, "Keep keys in Secrets and use secret://name in a variable");
        for (const ref of secretRefs(e.value, vars, secretVars))
          if (!outside?.secret(ref, project)) add("secret_missing", node.id, "A secret it uses is not in Secrets");
      }
    if (node.kind !== "http") continue;
    if (flowHttpUrlProblem(node.url) === "private" && !allowedPrivateUrl(node.url, outside))
      add("url_private", node.id, "The address is on this computer or a private network");
    if (redactedJson({ url: node.url, body: node.body }) !== JSON.stringify({ url: node.url, body: node.body }))
      add("credential_literal", node.id, "Keep keys in Secrets and use secret://name in a header");
    for (const h of node.headers) {
      const literal = h.value.replace(SECRET_REF, "");
      const refs = secretRefs(h.value, vars, secretVars);
      if (CREDENTIAL_HEADER.test(h.name) && !refs.length)
        add("credential_literal", node.id, "Keep keys in Secrets and use secret://name in a header");
      else if (redactedJson({ v: literal }) !== JSON.stringify({ v: literal }))
        add("credential_literal", node.id, "Keep keys in Secrets and use secret://name in a header");
      for (const ref of refs)
        if (!outside?.secret(ref, project)) add("secret_missing", node.id, "A secret it uses is not in Secrets");
    }
  }
  return issues;
}

/** A test's own fake server is not refused for being on this computer; nothing else is let through. */
export function allowedPrivateUrl(url: string, outside: FlowOutside | undefined): boolean {
  if (!outside?.allowHttp?.length || flowHttpUrlProblem(url) !== "private") return false;
  try {
    const u = new URL(url);
    const port = Number(u.port || (u.protocol === "https:" ? 443 : 80));
    return outside.allowHttp.includes(`${u.hostname.replace(/^\[|\]$/g, "")}:${port}`);
  } catch {
    return false;
  }
}
