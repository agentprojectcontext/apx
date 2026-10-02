import { Button, Dialog, EmptyState, Icons, Input, MasterDetail, PickRow, Tag, Textarea } from "@apx/ui";
import { useState } from "react";
import { projectName } from "../data/identity.ts";
import { type SkillInfo, saveSkill } from "../data/resources.ts";
import { useData } from "../data/state.ts";
import { useT } from "../i18n/index.ts";
import { sourceTag } from "./labels.ts";
import type { TabProps } from "./ResourcesView.tsx";
import { ScopedGroups, useInheritance } from "./ScopedGroups.tsx";
import { SkillDetail } from "./SkillDetail.tsx";

const keyOf = (s: SkillInfo) => `${s.scope}:${s.project_id ?? ""}:${s.name}`;

/** Skills grouped: inside a project its own first, then the inherited global ones; globally by scope. */
export function SkillsTab({ projectId, query, scope, adding, setAdding, res }: TabProps) {
  const t = useT();
  const projects = useData((s) => s.projects);
  const [picked, setPicked] = useState<string>();
  const all = res.data.skills;
  const shown = (all ?? []).filter(
    (s) =>
      (!query || `${s.name} ${s.description}`.toLowerCase().includes(query)) &&
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
    return (
      <PickRow
        key={keyOf(s)}
        mono
        title={s.name}
        description={s.description || t("res.noDescription")}
        trailing={tag && <Tag>{tag}</Tag>}
        dot={s.on ? "on" : "off"}
        muted={!s.on}
        selected={keyOf(s) === picked}
        onClick={() => setPicked(keyOf(s))}
      />
    );
  };

  return (
    <>
      <MasterDetail
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
              key={keyOf(current)}
              skill={current}
              projectId={projectId}
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
      {adding && (
        <NewSkill
          projectId={projectId}
          onClose={() => setAdding(false)}
          onCreated={async (s) => {
            setAdding(false);
            await res.loadSkills();
            setPicked(keyOf(s));
          }}
        />
      )}
    </>
  );
}

function NewSkill(props: { projectId: string | undefined; onClose(): void; onCreated(s: SkillInfo): void }) {
  const t = useT();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [busy, setBusy] = useState(false);
  const valid = /^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,63}$/.test(name) && description.trim().length > 0;
  const create = async () => {
    setBusy(true);
    const content = `---\nname: ${name}\ndescription: ${description.trim().replace(/\n/g, " ")}\n---\n\n${t("res.skillStub")}\n`;
    const s = await saveSkill(name, props.projectId ? "project" : "global", content, props.projectId);
    setBusy(false);
    if (s) props.onCreated(s);
  };
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && props.onClose()}
      title={t("res.newSkill")}
      description={props.projectId ? t("res.newSkill.project") : t("res.newSkill.global")}
      footer={
        <>
          <Button variant="secondary" onClick={props.onClose}>
            {t("common.cancel")}
          </Button>
          <Button disabled={!valid} loading={busy} onClick={() => void create()}>
            {t("res.create")}
          </Button>
        </>
      }
    >
      <div className="pform">
        <div className="pform__field">
          <span className="pform__label">{t("res.skillName")}</span>
          <Input
            aria-label={t("res.skillName")}
            value={name}
            placeholder="weekly-report"
            onChange={(e) => setName(e.currentTarget.value)}
          />
          <span className="pform__hint">{t("res.skillNameHint")}</span>
        </div>
        <div className="pform__field">
          <span className="pform__label">{t("res.skillDescription")}</span>
          <Textarea
            aria-label={t("res.skillDescription")}
            rows={2}
            value={description}
            onChange={(e) => setDescription(e.currentTarget.value)}
          />
          <span className="pform__hint">{t("res.skillDescriptionHint")}</span>
        </div>
      </div>
    </Dialog>
  );
}
