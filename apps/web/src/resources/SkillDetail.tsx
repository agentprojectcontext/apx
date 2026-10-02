import { Badge, Button, Dialog, MarkdownView, SegmentedControl, Skeleton, Switch, Tag, Textarea } from "@apx/ui";
import { useEffect, useState } from "react";
import { projectName } from "../data/identity.ts";
import { getSkill, type SkillInfo, saveSkill, toggleSkill } from "../data/resources.ts";
import { useData } from "../data/state.ts";
import { useT } from "../i18n/index.ts";
import { sourceTag } from "./labels.ts";

/** The body without its frontmatter, for the rendered view. */
const bodyOf = (text: string) => text.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, "").trim();

/**
 * One skill: where it comes from, who uses it, where it is on, and its SKILL.md to read or edit. A global skill edited
 * from a project asks whether to change the original or give the project its own copy.
 */
export function SkillDetail({
  skill,
  projectId,
  onChanged,
}: {
  skill: SkillInfo;
  projectId: string | undefined;
  onChanged(next?: SkillInfo): Promise<void> | void;
}) {
  const t = useT();
  const projects = useData((s) => s.projects);
  const agents = useData((s) => s.agents);
  const [content, setContent] = useState<string>();
  const [draft, setDraft] = useState<string>();
  const [mode, setMode] = useState("view");
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);
  const context = projectId ?? skill.project_id;
  useEffect(() => {
    void getSkill(skill.name, context).then((r) => setContent(r?.content ?? ""));
  }, [skill.name, context]);

  const inherited = Boolean(projectId) && skill.scope === "global";
  const usedBy = Object.values(agents).filter((a) =>
    a.skills?.some((s) => s.toLowerCase() === skill.name.toLowerCase()),
  );
  const dirty = draft !== undefined && draft !== content;
  const save = async (target: "global" | "project") => {
    if (draft === undefined) return;
    setBusy(true);
    const next = await saveSkill(skill.name, target, draft, target === "project" ? context : undefined);
    setBusy(false);
    setAsking(false);
    if (!next) return;
    setContent(draft);
    setDraft(undefined);
    await onChanged(next);
  };
  const tag = sourceTag(skill, t);

  return (
    <article className="resd">
      <header className="resd__head">
        <h2 className="resd__name">{skill.name}</h2>
        <Badge>{skill.scope === "project" ? t("res.scope.project") : t("res.scope.global")}</Badge>
        {inherited && <Badge>{t("res.inherited")}</Badge>}
        {tag && <Tag>{tag}</Tag>}
        <span className="resd__spacer" />
        <Switch
          checked={skill.on}
          label={t("res.active")}
          // Off everywhere wins: a project cannot turn it back on for itself (the global view can).
          disabled={Boolean(projectId) && skill.off_everywhere}
          onCheckedChange={(on) =>
            void toggleSkill(skill.name, on, projectId ?? skill.project_id).then(() => onChanged())
          }
        />
      </header>
      {skill.description && <p className="resd__desc">{skill.description}</p>}
      {inherited && (
        <p className="resd__note">{t("res.skillInheritedNote", { name: projectName(projects, projectId) })}</p>
      )}

      <dl className="resd__facts">
        <dt>{t("res.loads")}</dt>
        <dd>{t("res.loadsOnDemand")}</dd>
        <dt>{t("res.usedBy")}</dt>
        <dd className="resd__chips">
          {usedBy.length ? usedBy.map((a) => <Tag key={a.id}>{a.name}</Tag>) : <Tag>{t("res.everyone")}</Tag>}
        </dd>
        <dt>{t("res.path")}</dt>
        <dd className="resd__mono">{skill.path}</dd>
      </dl>

      {!projectId && skill.scope === "global" && projects.some((p) => p.path) && (
        <section className="resd__section">
          <h3 className="resd__h3">{t("res.availableIn")}</h3>
          <ul className="resd__toggles">
            {projects
              .filter((p) => p.path)
              .map((p) => (
                <li key={p.id}>
                  <span>{p.name}</span>
                  <Switch
                    size="sm"
                    checked={skill.on && !skill.off_in.includes(p.id)}
                    disabled={!skill.on}
                    aria-label={t("res.availableInProject", { name: p.name })}
                    onCheckedChange={(on) => void toggleSkill(skill.name, on, p.id).then(() => onChanged())}
                  />
                </li>
              ))}
          </ul>
        </section>
      )}

      <div className="resd__viewbar">
        <SegmentedControl
          size="sm"
          label={t("res.skillView")}
          value={mode}
          onValueChange={setMode}
          options={[
            { value: "view", label: t("res.view") },
            { value: "source", label: t("res.source") },
          ]}
        />
        {dirty && (
          <span className="resd__actions">
            <Button size="sm" variant="secondary" onClick={() => setDraft(undefined)}>
              {t("res.discard")}
            </Button>
            <Button size="sm" loading={busy} onClick={() => (inherited ? setAsking(true) : void save(skill.scope))}>
              {t("common.save")}
            </Button>
          </span>
        )}
      </div>
      {content === undefined ? (
        <Skeleton height={180} />
      ) : mode === "view" ? (
        <div className="resd__doc">
          <MarkdownView source={bodyOf(draft ?? content)} />
        </div>
      ) : (
        <Textarea
          className="resd__source"
          aria-label={t("res.source")}
          rows={18}
          readOnly={!skill.editable}
          value={draft ?? content}
          onChange={(e) => setDraft(e.currentTarget.value)}
        />
      )}
      {!skill.editable && <p className="resd__note">{t("res.extensionReadOnly")}</p>}

      {asking && (
        <Dialog
          open
          onOpenChange={(o) => !o && setAsking(false)}
          title={t("res.saveWhere")}
          footer={
            <>
              <Button variant="secondary" onClick={() => void save("global")} loading={busy}>
                {t("res.saveOriginal")}
              </Button>
              <Button onClick={() => void save("project")} loading={busy}>
                {t("res.saveCopy", { name: projectName(projects, projectId) })}
              </Button>
            </>
          }
        >
          <p className="resd__note">{t("res.saveWhereBody", { name: projectName(projects, projectId) })}</p>
        </Dialog>
      )}
    </article>
  );
}
