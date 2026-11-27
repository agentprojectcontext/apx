import type { Client } from "@modelcontextprotocol/sdk/client/index.js";
import type { McpTool } from "./approval.ts";

export type Connected = { client: Client; tools: McpTool[]; errorMessage: (error: unknown) => string };

export type Conn = {
  key: string;
  hash: string;
  client?: Client;
  tools: McpTool[];
  status: "starting" | "ready" | "error" | "needs-sign-in";
  error?: string;
  errorMessage?: (error: unknown) => string;
  /** The page the server asked the owner to open, while it waits for them. */
  signInUrl?: string;
  /** Ends a start still under way, its process with it (one waiting on a sign-in lives for minutes). */
  stop?: () => Promise<void>;
  used: number;
  failedAt?: number;
  ready?: Promise<void>;
};
