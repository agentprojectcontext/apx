import { Badge, Button, ContextMenu, EmptyState, Icons, MasterDetail, PickRow, Tag } from "@apx/ui";
import { useEffect, useState } from "react";
import { projectName } from "../data/identity.ts";
import { type SkillInfo, toggleSkill } from "../data/resources.ts";
import { useData } from "../data/state.ts";
import { useT } from "../i18n/index.ts";
import { nav, useNav } from "../shell/nav.ts";
import { AddSkill, type ImportStart } from "./AddSkill.tsx";
import { copyTag, engineOf, inEngines, sourceTag } from "./labels.ts";
import type { TabProps } from "./ResourcesView.tsx";
import { ScopedGroups, useInheritance } from "./ScopedGroups.tsx";
import { SkillDetail } from "./SkillDetail.tsx";

const keyOf = (s: SkillInfo) => `${s.scope}:${s.project_id ?? ""}:${s.name}`;

/** Another app's skill copied into APX: its folder, into APX's skills (or the project's, for a project's own). */
export const copyStart = (s: SkillInfo): ImportStart => ({
  source: { kind: "folder", path: s.path.replace(/[\\/]SKILL\.md$/, "") },
  project: s.scope === "project" ? s.project_id : undefined,
});

/** Skills grouped: inside a project its own first, then the inherited global ones; globally by scope. */
export function SkillsTab({ projectId, query, scope, adding, setAdding, res, ownOnly, engines }: TabProps) {
  const t = useT();
  const projects = useData((s) => s.projects);
  const [picked, setPicked] = useState<string>();
  /** Opened from "Edit" in the list's menu: the detail starts on its source (a new number remounts it). */
  const [editing, setEditing] = useState(0);
  const [copying, setCopying] = useState<ImportStart>();
  const all = res.data.skills;
  // "Open skill" from a chip in the chat: that skill is picked once the list is here.
  const focus = useNav((s) => s.focus);
  useEffect(() => {
    if (!focus?.startsWith("skill:") || !all) return;
    const name = focus.slice("skill:".length);
    const s = all.find((x) => x.name === name && x.project_id === projectId) ?? all.find((x) => x.name === name);
    if (s) setPicked(keyOf(s));
    nav.set({ focus: undefined });
  }, [focus, all, projectId]);
  const shown = (all ?? []).filter(
    (s) =>
      (!query || `${s.name} ${s.description}`.toLowerCase().includes(query)) &&
      (!engines || inEngines(s, engines)) &&
      (projectId || scope === "all" || (scope === "global" ? s.scope === "global" : s.project_id === scope)),
  );
  const groups = projectId
    ? [
        {
          title: t("res.group.own", { name: projectName(projects, projectId) }),
          items: shown.filter((s) => s.scope === "project"),
        },
        { title: t("res.group.inherited"), items: shown.filter((s) => s.scope === "global") },
      ]
    : [
        { title: t("res.scope.global"), items: shown.filter((s) => s.scope === "global") },
        ...projects
          .filter((p) => shown.some((s) => s.project_id === p.id))
          .map((p) => ({ title: p.name, items: shown.filter((s) => s.project_id === p.id) })),
      ];
  const current = shown.find((s) => keyOf(s) === picked) ?? (all ?? []).find((s) => keyOf(s) === picked);
  const inherit = useInheritance(projectId, "skills", res.loadSkills);
  const row = (s: SkillInfo) => {
    const tag = sourceTag(s, t);
    const fromApp = engineOf(s.source) !== "apx";
    const open = (edit: boolean) => {
      setPicked(keyOf(s));
      setEditing(edit ? Date.now() : 0);
    };
    return (
      <ContextMenu
        key={keyOf(s)}
        items={[
          { label: t("res.open"), icon: <Icons.PanelRight size={14} />, onSelect: () => open(false) },
          ...(s.editable
            ? [{ label: t("res.edit"), icon: <Icons.Pencil size={14} />, onSelect: () => open(true) }]
            : []),
          ...(fromApp && !s.editable
            ? [{ label: t("res.copyToApx"), icon: <Icons.Copy size={14} />, onSelect: () => setCopying(copyStart(s)) }]
            : []),
          // APX's own skills are always on.
          ...(s.source === "apx"
            ? []
            : [
                {
                  label: s.on ? t("res.turnOff") : t("res.turnOn"),
                  icon: <Icons.Power size={14} />,
                  disabled: Boolean(projectId) && s.off_everywhere,
                  onSelect: () =>
                    void toggleSkill(s.name, !s.on, projectId ?? s.project_id).then(() => res.loadSkills()),
                },
              ]),
        ]}
      >
        <PickRow
          mono
          title={s.name}
          description={s.description || t("res.noDescription")}
          trailing={
            (tag || s.copies.length > 0) && (
              <span className="resv__tags">
                {s.copies.length > 0 && (
                  <Badge
                    tone="warning"
                    title={t("res.duplicateTitle", { where: s.copies.map((c) => copyTag(c, t)).join(", ") })}
                  >
                    {t("res.duplicate")}
                  </Badge>
                )}
                {tag && <Tag>{tag}</Tag>}
              </span>
            )
          }
          dot={s.on ? "on" : "off"}
          muted={!s.on}
          selected={keyOf(s) === picked}
          onClick={() => open(false)}
        />
      </ContextMenu>
    );
  };

  const newSkill = (adding || copying) && (
    <AddSkill
      projectId={projectId}
      start={copying}
      onClose={() => {
        setAdding(false);
        setCopying(undefined);
      }}
      onDone={async (s) => {
        setAdding(false);
        setCopying(undefined);
        await res.loadSkills();
        if (s) setPicked(keyOf(s));
      }}
    />
  );
  // None at all yet: the invitation alone, no empty list beside it.
  if (all && !all.length && !projectId)
    return (
      <div className="resvars">
        <EmptyState
          variant="dashed"
          icon={<Icons.Sparkles />}
          title={t("res.noSkills")}
          action={
            <Button size="sm" leadingIcon={<Icons.Plus size={14} />} onClick={() => setAdding(true)}>
              {t("res.add.skill")}
            </Button>
          }
        />
        {newSkill}
      </div>
    );
  return (
    <>
      <MasterDetail
        resizeKey="skills"
        listLabel={t("res.tab.skills")}
        backLabel={t("res.tab.skills")}
        onBack={() => setPicked(undefined)}
        list={
          all && !shown.length ? (
            <EmptyState variant="dashed" size="sm" icon={<Icons.Sparkles />}>
              {query ? t("res.noMatch") : t("res.noSkills")}
            </EmptyState>
          ) : projectId ? (
            <ScopedGroups
              ownTitle={groups[0]?.title ?? ""}
              own={groups[0]?.items ?? []}
              globals={groups[1]?.items ?? []}
              inherit={inherit}
              emptyOwn={t("res.noOwnSkills")}
              render={row}
              ownOnly={ownOnly}
            />
          ) : (
            groups
              .filter((g) => g.items.length)
              .map((g) => (
                <div key={g.title} className="resv__group">
                  <div className="resv__grouptitle">
                    {g.title} <span>{g.items.length}</span>
                  </div>
                  {g.items.map(row)}
                </div>
              ))
          )
        }
        detail={
          current && (
            <SkillDetail
              key={`${keyOf(current)}:${editing}`}
              skill={current}
              projectId={projectId}
              editing={editing > 0}
              onCopy={() => setCopying(copyStart(current))}
              onChanged={async (next) => {
                await res.loadSkills();
                if (next) setPicked(keyOf(next));
              }}
            />
          )
        }
        empty={
          <EmptyState variant="dashed" icon={<Icons.Sparkles />} title={t("res.pickSkill.title")}>
            {t("res.pickSkill.body")}
          </EmptyState>
        }
      />
      {newSkill}
    </>
  );
}
