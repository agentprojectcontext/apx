import { Icons, ProjectTile, Switch } from "@apx/ui";
import { DEFAULT_PID, nestProjects, projectEntries, projectInitial, projectTone } from "../data/identity.ts";
import { useData } from "../data/state.ts";
import { useT } from "../i18n/index.ts";
import { ProjectBadge } from "../inbox/ProjectBadge.tsx";

/** Where a resource lives: "Global", or its project's name in that project's colour. */
export function OriginChip({ project }: { project: string | undefined }) {
  const t = useT();
  const projects = useData((s) => s.projects);
  if (!project) return <span className="projbadge is-global">{t("res.scope.global")}</span>;
  const name = projects.find((p) => p.id === project)?.name ?? project;
  return <ProjectBadge id={project} name={name} />;
}

/**
 * "By project": every project a resource reaches, its subprojects indented under it, with a switch each. A global
 * resource reaches every project (the base one first, standing for everywhere); a project's own, that project and its
 * subprojects.
 */
export function ByProject({
  name,
  origin,
  isOn,
  onToggle,
  withBase = false,
  disabled = false,
}: {
  /** The resource's name, for each switch's label. */
  name: string;
  /** The project it belongs to; undefined: global. */
  origin: string | undefined;
  /** Whether it is on there; `undefined` is the base project (everywhere). */
  isOn(project: string | undefined): boolean;
  onToggle(project: string | undefined, on: boolean): void;
  /** Lists the base project as the origin row of a global resource, its switch the resource's own. */
  withBase?: boolean;
  /** Always on (APX's own): shown, not changed. */
  disabled?: boolean;
}) {
  const t = useT();
  const projects = useData((s) => s.projects);
  const all = nestProjects(projectEntries(projects));
  const rows = origin
    ? all.filter((p) => p.id === origin || p.parent === origin)
    : all.filter((p) => withBase || p.id !== DEFAULT_PID);
  if (!rows.length || (rows.length === 1 && rows[0]?.id === DEFAULT_PID)) return null;
  const everywhere = isOn(undefined);
  return (
    <section className="resd__section">
      <h3 className="resd__bylabel">{t("res.byProject")}</h3>
      <ul className="resd__byproject">
        {rows.map((p) => {
          const base = p.id === DEFAULT_PID;
          const sub = Boolean(p.parent);
          const id = base ? undefined : p.id;
          const own = base ? !origin : p.id === origin;
          return (
            <li key={p.id} className={sub ? "is-sub" : undefined}>
              {sub ? (
                <Icons.Folder size={14} className="resd__folder" />
              ) : (
                <ProjectTile tone={projectTone(p.id)} initial={projectInitial(p.name)} size={20} />
              )}
              <span className="resd__byname">{p.name}</span>
              <span className="resd__bynote">{own ? t("res.originNote") : sub ? t("res.inheritedNote") : ""}</span>
              <Switch
                size="sm"
                checked={isOn(id)}
                // Off everywhere wins over a project's own switch.
                disabled={disabled || (!base && !everywhere)}
                aria-label={t("res.onInProject", { resource: name, name: p.name })}
                onCheckedChange={(on) => onToggle(id, on)}
              />
            </li>
          );
        })}
      </ul>
      <p className="resd__bynote resd__byhint">{t("res.subprojectsNote")}</p>
    </section>
  );
}
