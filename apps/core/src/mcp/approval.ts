import { createHash } from "node:crypto";
import type { ApprovalTarget } from "../domain/approvals.ts";
import type { McpDef } from "./config.ts";

export type McpTool = {
  name: string;
  title?: string;
  description?: string;
  inputSchema: Record<string, unknown>;
  annotations?: { readOnlyHint?: boolean; destructiveHint?: boolean; title?: string };
};

export const serverApprovalId = (d: Pick<McpDef, "scope" | "project_id" | "name">) =>
  JSON.stringify([d.scope, d.project_id ?? "", d.name]);

/** The tool name a server-wide grant ("allow all") is stored under. */
const ALL_TOOLS = "*";

/**
 * "Allow all" for one server: bound to its definition and credential scope like a tool's grant, but to no tool
 * contract, so tools the server adds later are covered too. DECISIONS.md#d-219
 */
export function mcpServerApproval(d: McpDef): ApprovalTarget {
  const key = createHash("sha256")
    .update(JSON.stringify([serverApprovalId(d), d.hash, d.values_of ?? "", ALL_TOOLS]))
    .digest("hex");
  return {
    key,
    server: serverApprovalId(d),
    tool: ALL_TOOLS,
    ...((d.project_id ?? d.values_of ?? d.only) ? { project_id: d.project_id ?? d.values_of ?? d.only } : {}),
    permanent: false,
  };
}

/** Definition, credential scope and tool contract bind approval; names alone are not authority. */
export function mcpApproval(d: McpDef, t: McpTool): ApprovalTarget {
  const key = createHash("sha256")
    .update(JSON.stringify([serverApprovalId(d), d.hash, d.values_of ?? "", t.name, t.inputSchema, t.annotations]))
    .digest("hex");
  return {
    key,
    server: serverApprovalId(d),
    tool: t.name,
    ...((d.project_id ?? d.values_of ?? d.only) ? { project_id: d.project_id ?? d.values_of ?? d.only } : {}),
    permanent: t.annotations?.readOnlyHint === true && t.annotations?.destructiveHint !== true,
    group: mcpServerApproval(d).key,
  };
}
