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
  };
}
