import { createHash } from "node:crypto";
import type { Bus } from "../bus.ts";
import type { AgentRecord } from "./agents.ts";
import { HOME_THREAD_ID } from "./seed.ts";
import type { Store } from "./store.ts";

const KEY = "agent_review_v1";
type State = { seen: Record<string, string>; pending: Record<string, string> };

function state(store: Store): State {
  try {
    const value: unknown = JSON.parse(store.settings.get(KEY) ?? "null");
    if (value && typeof value === "object" && "seen" in value && "pending" in value) {
      const strings = (v: unknown): v is Record<string, string> =>
        !!v && typeof v === "object" && !Array.isArray(v) && Object.values(v).every((x) => typeof x === "string");
      if (strings(value.seen) && strings(value.pending))
        return {
          seen: Object.assign(Object.create(null), value.seen),
          pending: Object.assign(Object.create(null), value.pending),
        };
    }
  } catch {}
  return { seen: Object.create(null), pending: Object.create(null) };
}

/** A review binds instructions and their scope, not a model or an avatar. */
export function agentRevision(store: Store, a: AgentRecord): string {
  const project = a.project_id ? store.projects.get(a.project_id) : undefined;
  return createHash("sha256")
    .update(
      JSON.stringify([
        a.prompt,
        a.name,
        a.role,
        a.description,
        a.project_id,
        a.parent,
        a.area,
        a.personality,
        a.tools,
        a.skills,
        a.rules,
        a.autonomy,
        a.orchestrator,
        project?.context,
        project?.path,
        project?.read_only_folders,
        project?.autonomy,
      ]),
    )
    .digest("hex");
}

export function pendingAgentReviews(store: Store, projectId?: string) {
  const pending = state(store).pending;
  return store.agents.list().flatMap((a) =>
    pending[a.id] && (!projectId || a.project_id === projectId)
      ? [
          {
            agent: a.id,
            name: a.name,
            ...(a.project_id ? { project_id: a.project_id } : {}),
            revision: agentRevision(store, a),
          },
        ]
      : [],
  );
}

/** Only a successfully applied, revision-checked proposal acknowledges its resulting definition. */
export function acknowledgeAgentReview(store: Store, a: AgentRecord): void {
  const s = state(store);
  s.seen[a.id] = agentRevision(store, a);
  delete s.pending[a.id];
  store.settings.set(KEY, JSON.stringify(s));
  if (!store.agents.list().some((b) => b.project_id === a.project_id && s.pending[b.id]))
    store.notifications.resolve("agent", `agent-review:${a.project_id ?? "global"}`);
}

/** All writers converge on team.updated, including file reindexing and importers. No model call runs here. */
export function watchAgentReviews(store: Store, bus: Bus): () => void {
  let closed = false;
  let queued = false;
  const scan = () => {
    const previous = store.settings.get(KEY);
    const initialized = previous !== undefined;
    const s = state(store);
    const active = store.agents.list();
    const ids = new Set(active.map((a) => a.id));
    const changedScopes = new Set<string>();
    for (const a of active) {
      const revision = agentRevision(store, a);
      if (initialized && s.seen[a.id] !== revision) {
        s.pending[a.id] = revision;
        changedScopes.add(a.project_id ?? "");
      }
      s.seen[a.id] = revision;
    }
    for (const id of Object.keys(s.seen))
      if (!ids.has(id)) {
        delete s.seen[id];
        delete s.pending[id];
      }
    const next = JSON.stringify(s);
    if (next !== previous) store.settings.set(KEY, next);
    for (const scope of changedScopes) {
      const agents = active.filter((a) => (a.project_id ?? "") === scope && s.pending[a.id]);
      if (!agents.length) continue;
      const en = store.settings.get("owner_language") === "en";
      const projectName = scope ? store.projects.get(scope)?.name : undefined;
      const names = agents
        .slice(0, 5)
        .map((a) => a.name)
        .join(", ");
      const more = agents.length > 5 ? (en ? ` and ${agents.length - 5} more` : ` y ${agents.length - 5} más`) : "";
      store.notifications.add({
        kind: "agent",
        ref: `agent-review:${scope || "global"}`,
        title: en ? "Review changed agents" : "Revisá los agentes modificados",
        body: `${projectName ? `${projectName}: ` : ""}${names}${more}. ${en ? "Ask your super-agent to review their instructions before changing anything." : "Pedile a tu super-agente que revise sus instrucciones antes de cambiar algo."}`,
        thread_id: HOME_THREAD_ID,
      });
    }
    for (const n of store.notifications.list({ unreadOnly: true, limit: 500 })) {
      if (n.kind !== "agent" || !n.ref?.startsWith("agent-review:")) continue;
      const scope = n.ref.slice("agent-review:".length);
      if (!active.some((a) => (a.project_id ?? "global") === scope && s.pending[a.id]))
        store.notifications.resolve("agent", n.ref);
    }
  };
  scan();
  const off = bus.on((e) => {
    if (e.type !== "team.updated" || queued) return;
    queued = true;
    queueMicrotask(() => {
      queued = false;
      if (!closed) scan();
    });
  });
  return () => {
    closed = true;
    off();
  };
}
