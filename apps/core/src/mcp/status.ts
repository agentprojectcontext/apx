export type McpStatus = {
  name: string;
  connection_generation?: string;
  scope: "global" | "project";
  project_id?: string;
  values_of?: string;
  credential_key?: string;
  only: boolean;
  transport: "stdio" | "http";
  target: string;
  enabled: boolean;
  trusted: boolean;
  status: "off" | "needs-approval" | "disabled" | "starting" | "ready" | "error" | "needs-sign-in";
  sign_in_url?: string;
  tools: number;
  tool_names: string[];
  tool_permission_mode: "unknown" | "ask" | "all" | "some";
  vars: Array<{ name: string; set: boolean }>;
  off_here: boolean;
  /** A global server: the projects it is turned off in (it is on in every other one). */
  off_in: string[];
  error?: string;
};
