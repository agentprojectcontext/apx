import "../styles/screens.css";
import type { Routine } from "@apx/protocol";
import { EmptyState, Icons, ProjectTile, SegmentedControl, Select } from "@apx/ui";
import { useEffect, useMemo, useState } from "react";
import { SectionPage } from "../common/SectionPage.tsx";
import { DEFAULT_PID, projectEntries, projectInitial, projectTone } from "../data/identity.ts";
import { draftOf, loadRoutines, type RoutineDraft, useRoutines } from "../data/routines.ts";
import { useData } from "../data/state.ts";
import { useT } from "../i18n/index.ts";
import { RoutineDrawer } from "./RoutineDrawer.tsx";
import { RoutineEditor } from "./RoutineEditor.tsx";
import { type RoutineGroup, RoutineList } from "./RoutineList.tsx";

type State = "all" | "on" | "off";
type Sort = "next" | "last" | "name";

/** Folds accents and case, so "resumen" finds "Resúmen". */
const fold = (s: string) => s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();

const byNext = (a: Routine, b: Routine) =>
  Number(!a.enabled) - Number(!b.enabled) ||
  (a.next_run_at ?? "~").localeCompare(b.next_run_at ?? "~") ||
  a.name.localeCompare(b.name);
const byLast = (a: Routine, b: Routine) =>
  (b.last?.started_at ?? "").localeCompare(a.last?.started_at ?? "") || a.name.localeCompare(b.name);
const byName = (a: Routine, b: Routine) => a.name.localeCompare(b.name);
const SORTS: Record<Sort, (a: Routine, b: Routine) => number> = { next: byNext, last: byLast, name: byName };

/** Every routine of every project, grouped by project and filtered by what the owner looks for; a row opens its runs. */
export function RoutinesScreen() {
  const t = useT();
  const all = useRoutines((s) => s.routines);
  const ready = useRoutines((s) => s.ready);
  const projects = useData((s) => s.projects);
  const agents = useData((s) => s.agents);
  const [q, setQ] = useState("");
  const [project, setProject] = useState("");
  const [state, setState] = useState<State>("all");
  const [sort, setSort] = useState<Sort>("next");
  const [open, setOpen] = useState<string>();
  const [editing, setEditing] = useState<RoutineDraft>();
  useEffect(() => {
    void loadRoutines();
  }, []);
  const entries = useMemo(() => projectEntries(projects), [projects]);
  const listed = all.filter((r) => r.action !== "relay");
  const groups = useMemo<RoutineGroup[]>(() => {
    const words = fold(q.trim());
    const match = (r: Routine) =>
      (state === "all" || (state === "on" ? r.enabled : !r.enabled)) &&
      (!words || fold(`${r.name} ${agents[r.agent_id]?.name ?? ""}`).includes(words));
    return entries
      .filter((p) => !project || p.id === project)
      .map((p) => ({
        id: p.id,
        title: (
          <>
            <ProjectTile tone={projectTone(p.id)} initial={projectInitial(p.name)} />
            {p.name}
          </>
        ),
        routines: listed
          .filter((r) => (p.id === DEFAULT_PID ? !r.project_id : r.project_id === p.id) && match(r))
          .sort(SORTS[sort]),
      }))
      .filter((g) => g.routines.length > 0);
  }, [entries, listed, project, state, sort, q, agents]);
  const current = listed.find((r) => r.id === open);
  const blank: RoutineDraft = {
    name: "",
    agent: "",
    ...(project && project !== DEFAULT_PID ? { project } : {}),
    schedule: { kind: "cron", cron: "0 9 * * *" },
    action: "agent",
    prompt: "",
    pre_command: "",
    post_command: "",
    call_model: "always",
    anchor: false,
    max_steps: "",
    enabled: true,
  };
  // Counted before the state filter, so each tab says how many it would show.
  const countable = listed.filter(
    (r) =>
      (!project || (project === DEFAULT_PID ? !r.project_id : r.project_id === project)) &&
      (!q.trim() || fold(`${r.name} ${agents[r.agent_id]?.name ?? ""}`).includes(fold(q.trim()))),
  );
  const count = { all: countable.length, on: countable.filter((r) => r.enabled).length, off: 0 };
  count.off = count.all - count.on;
  const empty = ready && listed.length === 0;
  return (
    <SectionPage
      className="page--routines"
      bodyClassName="page"
      label={t("nav.routines")}
      title={t("nav.routines")}
      lead={t("routines.allLead")}
      action={{ label: t("routines.new"), hint: t("section.routines.newHint"), onClick: () => setEditing(blank) }}
      tabs={
        !empty && (
          <SegmentedControl
            label={t("routines.filterState")}
            value={state}
            onValueChange={(v) => setState(v === "on" || v === "off" ? v : "all")}
            options={(["all", "on", "off"] as const).map((v) => ({
              value: v,
              label: (
                <span className="secpage__tab">
                  {t(`routines.state.${v}`)}
                  <span className="secpage__count">{count[v]}</span>
                </span>
              ),
            }))}
          />
        )
      }
      tools={
        !empty && (
          <Select
            size="sm"
            label={t("routines.sort")}
            value={sort}
            onValueChange={(v) => setSort(v === "last" || v === "name" ? v : "next")}
            options={[
              { value: "next", label: t("routines.sort.next") },
              { value: "last", label: t("routines.sort.last") },
              { value: "name", label: t("routines.sort.name") },
            ]}
          />
        )
      }
      search={empty ? undefined : { value: q, onChange: setQ, placeholder: t("routines.search") }}
      scopes={
        empty || entries.length < 2
          ? undefined
          : {
              label: t("routines.filterProject"),
              value: project || "all",
              onChange: (id) => setProject(id === "all" ? "" : id),
              options: [
                { id: "all", label: t("section.scope.all") },
                ...entries.map((p) => ({ id: p.id, label: p.name })),
              ],
            }
      }
    >
      <div className="routines">
        {empty ? (
          <EmptyState variant="dashed" size="lg" icon={<Icons.Clock />} title={t("routines.emptyTitle")}>
            {t("routines.empty")}
          </EmptyState>
        ) : groups.length === 0 ? (
          <EmptyState size="sm" icon={<Icons.Search />} title={t("routines.noMatch")} />
        ) : (
          <RoutineList
            groups={groups}
            open={open}
            onOpen={(id) => setOpen(open === id ? undefined : id)}
            onEdit={(r) => setEditing(draftOf(r))}
          />
        )}
      </div>
      {current && (
        <RoutineDrawer
          key={current.id}
          routine={current}
          agentName={agents[current.agent_id]?.name ?? current.agent_id}
          onEdit={() => setEditing(draftOf(current))}
          onClose={() => setOpen(undefined)}
        />
      )}
      {editing && <RoutineEditor draft={editing} onClose={() => setEditing(undefined)} />}
    </SectionPage>
  );
}
