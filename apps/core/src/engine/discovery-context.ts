import { createHash } from "node:crypto";
import type { DiscoverySettings } from "@apx/protocol";
import type { discoveryState } from "../domain/discovery-state.ts";
import { memorySensitive } from "../domain/memories.ts";
import type { Store } from "../domain/store.ts";
import { redactedJson } from "../log.ts";
import { discoveryActivity } from "./discovery-source.ts";

export function discoveryContext(
  store: Store,
  settings: DiscoverySettings,
  project: string | undefined,
  at: Date,
): string {
  const p = project ? store.projects.get(project) : undefined;
  const sources = settings.project_context
    ? discoveryActivity(store, project, new Date(+at - 7 * 86_400_000).toISOString(), at.toISOString())
    : [];
  const text = settings.project_context && p ? `${p.description ?? ""}\n${p.context ?? ""}\n${p.memory ?? ""}` : "";
  const tasks =
    settings.project_context && project
      ? store.tasks
          .list({ projects: [project], state: "open", limit: 30 })
          .map((t) => ({ title: t.title, goal: t.goal?.slice(0, 600) }))
      : [];
  return redactedJson({
    project: p?.name,
    context: memorySensitive(text) ? "" : text.slice(0, 8000),
    tasks,
    activity: sources,
    interests: settings.interests,
    location: settings.location || null,
    language: store.settings.get("owner_language") ?? "en",
    today: at.toISOString(),
  });
}

export function discoverySources(
  store: Store,
  settings: DiscoverySettings,
  allowed: ReturnType<typeof discoveryState>["allowed"],
) {
  const sources = settings.sources.filter((s) => allowed(s.project)).map((s) => ({ ...s, explicit: true }));
  if (settings.project_websites) {
    for (const project of store.projects.list().filter((p) => allowed(p.id))) {
      const roots = new Set<string>();
      const text = `${project.description ?? ""}\n${project.context ?? ""}\n${project.memory ?? ""}`;
      for (const match of text.matchAll(/https:\/\/[^\s<>"')\]]+/g)) {
        try {
          const url = new URL(match[0]);
          if (url.username || url.password || url.search || memorySensitive(url.hostname)) continue;
          roots.add(`${url.origin}/`);
        } catch {
          /* A malformed reference is not a public source. */
        }
      }
      if (!roots.size || sources.some((source) => source.project === project.id)) continue;
      sources.push({
        project: project.id,
        label: project.name,
        public_terms: "",
        pages: [...roots].slice(0, 4),
        explicit: false,
      });
    }
  }
  if (settings.interest_news)
    for (const interest of settings.interests)
      sources.push({
        project: undefined,
        label: interest,
        public_terms: settings.location ? `${interest} ${settings.location}`.slice(0, 250) : interest,
        pages: [],
        explicit: true,
      });
  return sources;
}
export function discoveryKey(value: unknown) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}
