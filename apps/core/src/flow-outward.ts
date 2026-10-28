// What a drawing does outside APX: where its notify steps send as the owner and which hosts its HTTP steps call.
// Publishing a revision is the owner's approval of exactly that list (DECISIONS.md#d-169), so the destinations are
// fixed fields of the revision, checked against the owner's own channels, contacts and secrets.
import type { FlowGraph, FlowGraphIssue, FlowNode } from "../../../packages/protocol/src/flow-graph.ts";
import type { ChannelConfig } from "./channels/types.ts";
import { flowHttpUrlProblem } from "./domain/flow-http-url.ts";
import { OWNER_ID } from "./domain/persons.ts";
import type { Store } from "./domain/store.ts";
import { redactedJson } from "./log.ts";

type Notify = Extract<FlowNode, { kind: "notify" }>;
type Http = Extract<FlowNode, { kind: "http" }>;

/** What checks a drawing's outward steps beyond its shape. */
export type FlowOutside = {
  /** Whether a `secret://name` resolves for the Flow's project. */
  secret(ref: string, project: string): boolean;
  /** A test's exact `host:port` destinations that are not public (empty in a real core). */
  allowHttp?: readonly string[] | undefined;
};

/** `secret://name` references in a header value; a name is letters, digits and `_ - . / ~`. */
export const SECRET_REF = /secret:\/\/[A-Za-z0-9_.~/-]{1,200}/g;
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

/** The sends and calls a drawing makes, and the keys the owner approves by publishing it. */
export function flowOutward(store: Store, graph: FlowGraph) {
  const sends: { node: string; channel: string; type: string; to: string; owner: boolean }[] = [];
  const calls: { node: string; method: string; host: string; secrets: string[] }[] = [];
  const secretsOf = (n: Http) => [
    ...new Set(n.headers.flatMap((h) => (h.value.match(SECRET_REF) ?? []).map((r) => r.slice(9)))),
  ];
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
  }
  const keys = [
    ...graph.nodes.flatMap((n) =>
      n.kind === "notify"
        ? [`send:${n.channel}:${n.to.kind === "room" ? `room:${n.to.room}` : `contact:${n.to.person}`}`]
        : n.kind === "http"
          ? // Which secrets go to which address is part of what the owner allows.
            [`call:${n.method}:${n.url}`, ...secretsOf(n).map((s) => `secret:${s}:${n.url}`)]
          : [],
    ),
  ];
  return { keys: [...new Set(keys)].sort(), sends, calls };
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
  for (const node of graph.nodes) {
    if (node.kind === "notify" && !notifyDestination(store, node))
      add("destination_unavailable", node.id, "Pick a channel and someone on it, or one of its rooms");
    if (node.kind !== "http") continue;
    if (flowHttpUrlProblem(node.url) === "private" && !allowedPrivateUrl(node.url, outside))
      add("url_private", node.id, "The address is on this computer or a private network");
    if (redactedJson({ url: node.url, body: node.body }) !== JSON.stringify({ url: node.url, body: node.body }))
      add("credential_literal", node.id, "Keep keys in Secrets and use secret://name in a header");
    for (const h of node.headers) {
      const literal = h.value.replace(SECRET_REF, "");
      const refs = h.value.match(SECRET_REF) ?? [];
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
