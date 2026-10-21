import type { Actor, ClientRole, ClientScope } from "@apx/protocol";
import type { Log } from "../log.ts";

/** Who is calling. Every handler gets it explicitly — no ambient/implicit identity. */
export type CallContext = {
  transport: "http" | "ws" | "internal";
  role: ClientRole;
  /** A human operator, or a model-driven client; methods marked `access: "human"` refuse the latter. */
  actor: Actor;
  session: string | undefined;
  log: Log;
  /** Set by the transport for direct loopback requests, never by a caller's payload. */
  local?: boolean;
  /** Set when an outside app calls with its client token: it acts as a model, only within its scopes. */
  client?: { id: string; name: string; scopes: ClientScope[] } | undefined;
  /** Set when one of the owner's paired devices calls with its own key. */
  device?: { id: string; name: string } | undefined;
  /** Set when an agent's tool calls a method in-process: which agent, in which run, thread and tool call. */
  agent?: { id: string; run_id: string; thread_id: string; call_id?: string | undefined } | undefined;
  /** Core-only certificates bound to reviewed memory text and sources; never decoded from request params. */
  memoryReviewed?: readonly string[] | undefined;
  /** Set by the channel manager only (never from a request): who wrote on which channel conversation. */
  channel?:
    | {
        id: string;
        conversation: string;
        message?: string | undefined;
        person_id: string;
        name: string;
        role: "owner" | "contact";
      }
    | undefined;
};
