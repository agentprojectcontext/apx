import { Button, EmptyState, Icons } from "@apx/ui";
import { useEffect, useState } from "react";
import { DEFAULT_PID } from "../data/identity.ts";
import { draftOf, loadRoutines, type RoutineDraft, useRoutines } from "../data/routines.ts";
import { useData } from "../data/state.ts";
import { useT } from "../i18n/index.ts";
import { go } from "../shell/nav.ts";
import { RoutineDrawer } from "./RoutineDrawer.tsx";
import { RoutineEditor } from "./RoutineEditor.tsx";
import { RoutineList } from "./RoutineList.tsx";

/**
 * A project's routines (the base project shows the global ones), one row each: what it does as a flow, its last
 * activations as a row of bars, when it runs next. A row opens its detail in a drawer at the right.
 */
export function RoutinesPane({ projectId }: { projectId: string }) {
  const t = useT();
  const all = useRoutines((s) => s.routines);
  const ready = useRoutines((s) => s.ready);
  const agents = useData((s) => s.agents);
  const [editing, setEditing] = useState<RoutineDraft>();
  const [open, setOpen] = useState<string>();
  useEffect(() => {
    void loadRoutines();
  }, []);
  const global = projectId === DEFAULT_PID;
  const list = all.filter((r) => r.action !== "relay" && (global ? !r.project_id : r.project_id === projectId));
  const current = list.find((r) => r.id === open);
  const blank: RoutineDraft = {
    name: "",
    agent: "",
    ...(global ? {} : { project: projectId }),
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

  return (
    <div className="board">
      <div className="board__head">
        <p className="config__lead">{t("routines.lead")}</p>
        <span className="board__spacer" />
        <Button size="sm" variant="secondary" onClick={() => go.flows(global ? undefined : projectId)}>
          {t("nav.flows")}
        </Button>
        <Button size="sm" leadingIcon={<Icons.Plus size={14} />} onClick={() => setEditing(blank)}>
          {t("routines.new")}
        </Button>
      </div>
      {ready && !list.length ? (
        <EmptyState variant="dashed" size="lg" icon={<Icons.Clock />} title={t("routines.emptyTitle")}>
          {t("routines.empty")}
        </EmptyState>
      ) : (
        <RoutineList
          groups={[{ id: projectId, routines: list }]}
          open={open}
          onOpen={(id) => setOpen(open === id ? undefined : id)}
          onEdit={(r) => setEditing(draftOf(r))}
        />
      )}
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
    </div>
  );
}
