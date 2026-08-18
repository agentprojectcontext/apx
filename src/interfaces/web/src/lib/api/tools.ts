import { http } from "../http";

export interface ToolInfo {
  name: string;
  description?: string;
  category?: string;
  endpoint?: string;
  /** Part of the safe default set a new agent is created with. */
  default_for_agents?: boolean;
}

export const Tools = {
  // Registry of built-in tools the daemon exposes.
  list: () => http.get<ToolInfo[]>("/api/tools"),
};
