// Connected nodes and the capabilities they lend. The core never executes a node capability itself:
// it routes the call and fails fast when no node offers it.
import { randomUUID } from "node:crypto";
import type { ApxErrorShape, EventFrame } from "@apx/protocol";
import { CallError } from "../errors.ts";

export type NodeLink = {
  session: string;
  name: string;
  caps: readonly string[];
  send(frame: object): void;
};

type Pending = {
  resolve: (v: unknown) => void;
  reject: (e: CallError) => void;
  timer: NodeJS.Timeout;
  session: string;
};

export function createNodeBroker() {
  const nodes = new Map<string, NodeLink>();
  const pending = new Map<string, Pending>();
  const eventListeners = new Set<(node: NodeLink, event: EventFrame) => void>();

  return {
    attach(link: NodeLink) {
      nodes.set(link.session, link);
    },

    detach(session: string) {
      nodes.delete(session);
      for (const [id, p] of pending) {
        if (p.session !== session) continue;
        clearTimeout(p.timer);
        pending.delete(id);
        p.reject(new CallError({ code: "unavailable", message: "node disconnected mid-call" }));
      }
    },

    withCap(cap: string): NodeLink | undefined {
      // Most recent node wins: reconnecting the desktop app replaces the stale link.
      return [...nodes.values()].reverse().find((n) => n.caps.includes(cap));
    },

    list() {
      return [...nodes.values()].map(({ session, name, caps }) => ({ session, name, caps }));
    },

    invoke(cap: string, method: string, params: unknown, deadlineMs: number): Promise<unknown> {
      const node = this.withCap(cap);
      if (!node) {
        return Promise.reject(
          new CallError({
            code: "unavailable",
            message: `no connected node offers "${cap}" (open the APX desktop app)`,
          }),
        );
      }
      const id = `n-${randomUUID()}`;
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          pending.delete(id);
          reject(
            new CallError({ code: "timeout", message: `${method} timed out after ${deadlineMs}ms on ${node.name}` }),
          );
        }, deadlineMs);
        pending.set(id, { resolve, reject, timer, session: node.session });
        node.send({ t: "req", id, method, params });
      });
    },

    /** A `res` frame arriving from a node. Unknown ids (late answers after a timeout) are dropped. */
    settle(id: string, body: { ok: true; result: unknown } | { ok: false; error: ApxErrorShape }) {
      const p = pending.get(id);
      if (!p) return;
      pending.delete(id);
      clearTimeout(p.timer);
      if (body.ok) p.resolve(body.result);
      else p.reject(new CallError(body.error));
    },

    event(session: string, event: EventFrame) {
      const node = nodes.get(session);
      if (node) for (const l of eventListeners) l(node, event);
    },

    onEvent(listener: (node: NodeLink, event: EventFrame) => void) {
      eventListeners.add(listener);
      return () => eventListeners.delete(listener);
    },
  };
}

export type NodeBroker = ReturnType<typeof createNodeBroker>;
