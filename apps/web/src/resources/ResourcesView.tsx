import { Button, Icons, Menu, SearchField, SegmentedControl } from "@apx/ui";
import { type ReactNode, useState } from "react";
import { type ProjectEntry, projectName } from "../data/identity.ts";
import { useData } from "../data/state.ts";
import { type MessageKey, useT } from "../i18n/index.ts";
import { go, type ResourceTab, useNav } from "../shell/nav.ts";
import { ExtensionsTab } from "./ExtensionsTab.tsx";
import { IntegrationsTab } from "./IntegrationsTab.tsx";
import { ENGINE_LABEL, SKILL_ENGINES, type SkillEngine } from "./labels.ts";
import { McpTab } from "./McpTab.tsx";
import { SkillsTab } from "./SkillsTab.tsx";
import { useResources } from "./useResources.ts";
import { VariablesTab } from "./VariablesTab.tsx";

const TABS: Array<{ id: ResourceTab; label: MessageKey; add?: MessageKey; search?: MessageKey }> = [
  { id: "skills", label: "res.tab.skills", add: "res.add.skill", search: "res.search.skills" },
  { id: "mcp", label: "res.tab.mcp", add: "res.add.mcp", search: "res.search.mcp" },
  { id: "integrations", label: "res.tab.integrations", add: "res.add.integration", search: "res.search.integrations" },
  { id: "variables", label: "res.tab.variables", add: "res.add.variable", search: "res.search.variables" },
  { id: "extensions", label: "res.tab.extensions", add: "res.add.extension" },
];

/** "all", "global" or a project id: which scope the global screen lists. */
export type ScopeFilter = string;

/**
 * Resources: skills, MCP servers, integrations, variables and extensions, in full tabs. The same screen globally
 * (with scope chips) and inside a project (its own plus the inherited global ones, which it can turn off here).
 */
export function ResourcesView({ project }: { project?: ProjectEntry }) {
  const t = useT();
  const projects = useData((s) => s.projects);
  const tab = useNav((s) => s.resourcesTab);
  const [query, setQuery] = useState("");
  const [picked, setScope] = useState<ScopeFilter>("all");
  const [adding, setAdding] = useState(false);
  const [ownOnly, setOwnOnly] = useState(false);
  const [engines, setEngines] = useState<ReadonlySet<SkillEngine>>(new Set());
  const projectId = project && !project.isDefault ? project.id : undefined;
  // Default's resources are the global ones, which every project takes: no other scope to pick there.
  const inDefault = Boolean(project?.isDefault);
  const scope: ScopeFilter = inDefault ? "global" : picked;
  const res = useResources(
    projectId,
    projects.filter((p) => p.path && p.registered !== false).map((p) => p.id),
  );
  const { skills, servers, secrets, extensions } = res.data;
  const counts: Record<ResourceTab, number | undefined> = {
    skills: skills?.length,
    mcp: servers?.length,
    integrations: undefined,
    // The table also lists names a server uses but nobody stored: count those too.
    variables:
      secrets &&
      new Set([
        ...secrets.map((x) => x.name),
        ...(servers ?? []).flatMap((srv) => srv.vars.filter((v) => !v.set).map((v) => v.name)),
      ]).size,
    extensions: extensions?.length,
  };
  const def = TABS.find((x) => x.id === tab) ?? (TABS[0] as (typeof TABS)[number]);
  const ctx = {
    projectId,
    query: query.trim().toLowerCase(),
    scope,
    adding,
    setAdding,
    res,
    ownOnly: Boolean(projectId) && ownOnly,
    engines,
  };
  const toggleEngine = (e: SkillEngine) =>
    setEngines((now) => {
      const next = new Set(now);
      if (!next.delete(e)) next.add(e);
      return next;
    });
  // Skills: the project's own or all, and which engines they live in (none picked: all).
  const skillFilters = tab === "skills" && (
    <span className="resv__filters">
      {projectId && (
        <SegmentedControl
          size="sm"
          label={t("res.show")}
          value={ownOnly ? "project" : "all"}
          onValueChange={(v) => setOwnOnly(v === "project")}
          options={[
            { value: "all", label: t("res.show.all") },
            { value: "project", label: t("res.show.project") },
          ]}
        />
      )}
      <Menu
        align="start"
        trigger={
          <Button size="sm" variant="secondary" trailingIcon={<Icons.ChevronDown size={14} />}>
            {engines.size
              ? SKILL_ENGINES.filter((e) => engines.has(e))
                  .map((e) => ENGINE_LABEL[e])
                  .join(", ")
              : t("res.engines.all")}
          </Button>
        }
        items={[
          { type: "label", label: t("res.engines") },
          ...SKILL_ENGINES.map((e) => ({
            label: ENGINE_LABEL[e],
            checked: engines.has(e),
            keepOpen: true,
            onSelect: () => toggleEngine(e),
          })),
        ]}
      />
    </span>
  );

  const name = projectId ? projectName(projects, projectId) : "";
  // What the list shows, said after the filters that change it.
  const note = [
    projectId
      ? tab === "skills" && ownOnly
        ? t("res.show.projectNote", { name })
        : t("res.inherit", { name })
      : inDefault
        ? t("res.defaultGlobal")
        : "",
    tab === "skills" && engines.size
      ? t("res.engines.note", {
          list: SKILL_ENGINES.filter((e) => engines.has(e))
            .map((e) => ENGINE_LABEL[e])
            .join(", "),
        })
      : "",
  ]
    .filter(Boolean)
    .join(" ");

  let body: ReactNode;
  if (tab === "skills") body = <SkillsTab {...ctx} />;
  else if (tab === "mcp") body = <McpTab {...ctx} />;
  else if (tab === "integrations") body = <IntegrationsTab {...ctx} />;
  else if (tab === "variables") body = <VariablesTab {...ctx} />;
  else body = <ExtensionsTab adding={adding} setAdding={setAdding} onChanged={() => void res.loadExtensions()} />;

  return (
    <section className={projectId ? "resv resv--project" : "resv"} aria-label={t("nav.resources")}>
      <header className="resv__head">
        {!projectId && (
          <div className="resv__titles">
            <h1 className="resv__title">{t("nav.resources")}</h1>
            <p className="resv__lead">{t("res.lead")}</p>
          </div>
        )}
        <div className="resv__bar">
          <SegmentedControl
            label={t("res.tabs")}
            value={tab}
            onValueChange={(v) => {
              setQuery("");
              setAdding(false);
              go.resourcesTab(v as ResourceTab);
            }}
            options={TABS.map((x) => ({
              value: x.id,
              label: (
                <span className="resv__tab">
                  {t(x.label)}
                  {counts[x.id] !== undefined && <span className="resv__count">{counts[x.id]}</span>}
                </span>
              ),
            }))}
          />
          <span className="resv__spacer" />
          {def.search && (
            <SearchField
              className="resv__search"
              aria-label={t(def.search)}
              placeholder={t(def.search)}
              value={query}
              onChange={(e) => setQuery(e.currentTarget.value)}
            />
          )}
          {def.add && (
            <Button size="sm" leadingIcon={<Icons.Plus size={14} />} onClick={() => setAdding(true)}>
              {t(def.add)}
            </Button>
          )}
        </div>
      </header>
      <div className="resv__under">
        {skillFilters}
        {!projectId && !inDefault && tab !== "extensions" && (
          <fieldset className="resv__scopes">
            <legend className="resv__scopelabel">{t("res.scope")}</legend>
            {[
              { id: "all", label: t("res.scope.all") },
              { id: "global", label: t("res.scope.global") },
              ...projects.filter((p) => p.path && p.registered !== false).map((p) => ({ id: p.id, label: p.name })),
            ].map((c) => (
              <button
                key={c.id}
                type="button"
                className={scope === c.id ? "resv__chip is-on" : "resv__chip"}
                aria-pressed={scope === c.id}
                onClick={() => setScope(c.id)}
              >
                {c.label}
              </button>
            ))}
          </fieldset>
        )}
        {note && <p className="resv__inherit">{note}</p>}
      </div>
      <div className="resv__body">{body}</div>
    </section>
  );
}

export type TabProps = {
  projectId: string | undefined;
  query: string;
  scope: ScopeFilter;
  adding: boolean;
  setAdding(on: boolean): void;
  res: ReturnType<typeof useResources>;
  /** Skills inside a project: only its own, not the inherited global ones. */
  ownOnly?: boolean;
  /** Skills living in these engines (or with a copy there); empty: all. */
  engines?: ReadonlySet<SkillEngine>;
};
