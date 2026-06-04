import { http } from "../http";

export interface ToolInfo {
  name: string;
  description?: string;
  category?: string;
  endpoint?: string;
}

export const Tools = {
  // Registry of built-in tools the daemon exposes.
  list: () => http.get<ToolInfo[]>("/tools"),
};
