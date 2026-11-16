// A read the owner is waiting to see, sent over the live socket when it is open. A browser opens only six HTTP
// connections to one host, so over HTTP it would wait behind the panel's slow requests. See HISTORY.md#widget-first-paint
import type { MethodName, Params, Result } from "@apx/protocol";
import type { ApxSocket } from "@apx/protocol/client";
import { client } from "./client.ts";

type Caller = Pick<ApxSocket, "call">;

let live: Caller | undefined;

/** The socket the live link holds while it is connected; undefined once it closes. */
export function setLiveSocket(socket: Caller | undefined): void {
  live = socket;
}

/** The same method and handler as client.call; over HTTP when there is no socket or it closed meanwhile. */
export async function socketCall<M extends MethodName>(method: M, params: Params<M>): Promise<Result<M>> {
  const s = live;
  if (!s) return client.call(method, params);
  try {
    return await s.call(method, params);
  } catch (e) {
    if (e instanceof Error && /^socket (not open|closed)$/.test(e.message)) return client.call(method, params);
    throw e;
  }
}
