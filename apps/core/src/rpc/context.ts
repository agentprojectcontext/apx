import type { ClientRole } from "@apx/protocol";
import type { Log } from "../log.ts";

/** Who is calling. Every handler gets it explicitly — no ambient/implicit identity. */
export type CallContext = {
  transport: "http" | "ws" | "internal";
  role: ClientRole;
  session: string | undefined;
  log: Log;
};
