import type { Params } from "@apx/protocol";

export type Flow = Params<"flows.set">;
export type FlowDraft = Omit<Flow, "predicates" | "action" | "readKeys"> & {
  filters: string;
  readKeysJson: string;
  actionKind: Flow["action"]["kind"];
  binding: string;
  prompt: string;
};

export function draftFlow(flow: Flow): FlowDraft {
  return {
    id: flow.id,
    projectId: flow.projectId,
    name: flow.name,
    enabled: flow.enabled,
    tableKey: flow.tableKey,
    readKeysJson: flow.readKeys === undefined ? "" : JSON.stringify(flow.readKeys),
    filters: JSON.stringify(flow.predicates, null, 2),
    actionKind: flow.action.kind,
    binding:
      flow.action.kind === "agent" ? flow.action.agent : flow.action.kind === "routine" ? flow.action.routine : "",
    prompt: flow.action.kind === "agent" ? flow.action.prompt : "",
  };
}

const idPattern = /^[A-Za-z0-9_-]{1,100}$/;
const text = (value: unknown, max: number): value is string =>
  typeof value === "string" && value.length > 0 && value.length <= max;

/** Validate editable JSON before sending; the protocol remains the authority on definitions and permissions. */
export function parseFlowDraft(d: FlowDraft): Flow | undefined {
  let predicates: unknown;
  try {
    predicates = JSON.parse(d.filters);
  } catch {
    return;
  }
  let readKeys: unknown;
  if (d.readKeysJson.trim()) {
    try {
      readKeys = JSON.parse(d.readKeysJson);
    } catch {
      return;
    }
    if (!Array.isArray(readKeys) || readKeys.length > 16 || !readKeys.every((key: unknown) => text(key, 128))) return;
  }
  if (!Array.isArray(predicates) || predicates.length > 32) return;
  for (const p of predicates) {
    if (!p || typeof p !== "object" || Object.keys(p).some((k) => k !== "path" && k !== "equals")) return;
    if (
      !Array.isArray(p.path) ||
      p.path.length < 1 ||
      p.path.length > 16 ||
      !p.path.every((v: unknown) => text(v, 128))
    )
      return;
    const value: unknown = p.equals;
    if (
      !(
        value === null ||
        typeof value === "boolean" ||
        (typeof value === "number" && Number.isFinite(value)) ||
        (typeof value === "string" && value.length <= 4096)
      )
    )
      return;
  }
  if (!idPattern.test(d.id) || !idPattern.test(d.projectId) || !text(d.name.trim(), 120) || !text(d.tableKey, 128))
    return;
  if (d.actionKind !== "none" && !idPattern.test(d.binding)) return;
  if (d.actionKind === "agent" && !text(d.prompt.trim(), 8000)) return;
  return {
    id: d.id,
    projectId: d.projectId,
    name: d.name.trim(),
    enabled: d.enabled,
    tableKey: d.tableKey,
    predicates,
    ...(readKeys === undefined ? {} : { readKeys: readKeys as string[] }),
    action:
      d.actionKind === "none"
        ? { kind: "none" }
        : d.actionKind === "routine"
          ? { kind: "routine", routine: d.binding }
          : { kind: "agent", agent: d.binding, prompt: d.prompt.trim() },
  };
}
