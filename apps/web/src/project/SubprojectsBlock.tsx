import { IconButton, Icons } from "@apx/ui";
import { Suspense, useMemo, useState } from "react";
import { type ProjectEntry, projectEntries, subprojectsOf, teamOf } from "../data/identity.ts";
import { useData } from "../data/state.ts";
import { useT } from "../i18n/index.ts";
import { NewProjectDialog } from "../lazy.ts";
import { go } from "../shell/nav.ts";

/**
 * A project's subprojects on its overview, with "+" to add one; on a subproject, the other subprojects of its project.
 * Each says whose agents it works with.
 */
export function SubprojectsBlock({ project }: { project: ProjectEntry }) {
  const t = useT();
  const projects = useData((s) => s.projects);
  const agents = useData((s) => s.agents);
  const [adding, setAdding] = useState(false);
  const entries = useMemo(() => projectEntries(projects), [projects]);
  const parent = project.parent ? entries.find((p) => p.id === project.parent) : undefined;
  const owner = parent ?? project;
  const list = subprojectsOf(entries, owner.id).filter((p) => p.id !== project.id);
  if (parent && list.length === 0) return null;
  return (
    <section className="overview__block">
      <h2 className="overview__h">
        {parent ? t("overview.otherSubs", { name: parent.name }) : t("overview.subprojects")}
        {!parent && (
          <IconButton
            size="sm"
            className="overview__hadd"
            label={t("project.newSub")}
            icon={<Icons.Plus size={14} />}
            onClick={() => setAdding(true)}
          />
        )}
      </h2>
      {list.length ? (
        list.map((p) => (
          <button key={p.id} type="button" className="overview__row" onClick={() => go.project(p.id)}>
            <Icons.Folder size={14} />
            <span className="overview__rowname">{p.name}</span>
            <span className="overview__rowwhen">
              {teamOf(agents, p.id).length
                ? t("overview.subOwn", { name: owner.name })
                : t("overview.subUses", { name: owner.name })}
            </span>
            <Icons.ChevronRight size={14} />
          </button>
        ))
      ) : (
        <p className="overview__hint">{t("overview.noSubs")}</p>
      )}
      {adding && (
        <Suspense fallback={null}>
          <NewProjectDialog parent={project.id} onClose={() => setAdding(false)} />
        </Suspense>
      )}
    </section>
  );
}
