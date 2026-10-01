import type { Actor, ClientRole } from "@apx/protocol";
import type { Log } from "../log.ts";

/** Who is calling. Every handler gets it explicitly — no ambient/implicit identity. */
export type CallContext = {
  transport: "http" | "ws" | "internal";
  role: ClientRole;
  /** A human operator, or a model-driven client; methods marked `access: "human"` refuse the latter. */
  actor: Actor;
  session: string | undefined;
  log: Log;
  /** Set when an agent's tool calls a method in-process: which agent, in which run and thread. */
  agent?: { id: string; run_id: string; thread_id: string } | undefined;
};
