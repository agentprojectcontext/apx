import { randomUUID } from "node:crypto";
import type { ToolApproval } from "@apx/protocol";

export type BrowserConsentContext = {
  origin: string;
  tab: string;
  epoch: string;
  run: string;
  title?: string;
  tab_number?: number;
};
export const BROWSER_CONSENT_TTL_MS = 30 * 60_000;

/** Ephemeral only: neither a chat grant nor a transferable permission for a tool. */
export function browserConsents(
  active: (run: string, thread: string, agent: string) => boolean,
  now: () => number = Date.now,
) {
  const grants = new Map<string, ToolApproval>();
  const changes = new Map<string, { revision: number; expires: number; thread: string }>();
  let revision = 0;
  const identity = (context: BrowserConsentContext, thread: string, agent: string) =>
    JSON.stringify([thread, agent, context.origin]);
  const changed = (context: BrowserConsentContext, thread: string, agent: string): number => {
    const next = ++revision;
    changes.set(identity(context, thread, agent), {
      revision: next,
      expires: now() + BROWSER_CONSENT_TTL_MS,
      thread,
    });
    return next;
  };
  const sweep = () => {
    for (const [key, value] of changes) if (value.expires <= now()) changes.delete(key);
    for (const [key, grant] of grants) {
      if (
        Date.parse(grant.expires_at ?? "") <= now() ||
        (grant.scope === "turn" && !active(grant.browser?.run ?? "", grant.thread_id ?? "", grant.agent_id ?? ""))
      )
        grants.delete(key);
    }
  };
  const version = (context: BrowserConsentContext, thread: string, agent: string): number => {
    sweep();
    const key = identity(context, thread, agent);
    return changes.get(key)?.revision ?? changed(context, thread, agent);
  };
  return {
    version,
    allows(context: BrowserConsentContext, thread: string, agent: string): boolean {
      sweep();
      for (const [key, grant] of grants) {
        const bound = grant.browser;
        if (!bound || grant.thread_id !== thread || grant.agent_id !== agent) continue;
        if (grant.scope === "tab" && bound.tab === context.tab && bound.epoch !== context.epoch) {
          grants.delete(key);
          continue;
        }
        if (bound.origin !== context.origin) continue;
        if (
          grant.scope === "turn"
            ? bound.run === context.run
            : bound.tab === context.tab && bound.epoch === context.epoch
        )
          return true;
      }
      return false;
    },
    grant(
      context: BrowserConsentContext,
      scope: "tab" | "turn",
      thread: string,
      agent: string,
      expectedRevision?: number,
    ): void {
      if (expectedRevision !== undefined && version(context, thread, agent) !== expectedRevision)
        throw new Error("Browser approval was revoked or declined while waiting; request a new evaluation");
      if (!active(context.run, thread, agent)) throw new Error("Browser approval requires its original active turn");
      sweep();
      const key = `apx:browser_evaluate:${randomUUID()}`;
      grants.set(key, {
        key,
        server: "apx",
        tool: "browser_evaluate",
        scope,
        thread_id: thread,
        agent_id: agent,
        browser: { ...context },
        granted_at: new Date(now()).toISOString(),
        ...(scope === "tab" ? { expires_at: new Date(now() + BROWSER_CONSENT_TTL_MS).toISOString() } : {}),
      });
    },
    list(thread?: string): ToolApproval[] {
      sweep();
      return [...grants.values()].filter((grant) => !thread || grant.thread_id === thread);
    },
    revoke(key: string, thread?: string, agent?: string): void {
      const grant = grants.get(key);
      if (grant && (!thread || grant.thread_id === thread) && (!agent || grant.agent_id === agent)) {
        if (grant.browser && grant.thread_id && grant.agent_id) changed(grant.browser, grant.thread_id, grant.agent_id);
        grants.delete(key);
      }
    },
    deny(context: BrowserConsentContext, thread: string, agent: string): void {
      changed(context, thread, agent);
      for (const [key, grant] of grants)
        if (grant.thread_id === thread && grant.agent_id === agent && grant.browser?.origin === context.origin)
          grants.delete(key);
    },
    endThread(thread: string): void {
      for (const value of changes.values())
        if (value.thread === thread) {
          value.revision = ++revision;
          value.expires = now() + BROWSER_CONSENT_TTL_MS;
        }
      for (const [key, grant] of grants) if (grant.thread_id === thread) grants.delete(key);
    },
  };
}
