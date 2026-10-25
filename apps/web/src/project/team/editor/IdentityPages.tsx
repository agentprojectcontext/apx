// The agent editor's general pages: identity (with area and role picked from the project or created on the spot),
// prompt, and model and team.
import type { Agent, Organization } from "@apx/protocol";
import {
  AgentAvatar,
  BLOB_NAMES,
  Button,
  Dialog,
  Field,
  Icons,
  Input,
  Select,
  SettingRow,
  Switch,
  Textarea,
} from "@apx/ui";
import { useState } from "react";
import { slugOf } from "../../../common/slug.ts";
import { AgentModelPicker } from "../../../config/models/AgentModelPicker.tsx";
import { DEFAULT_PID } from "../../../data/identity.ts";
import { saveOrg, useOrg } from "../../../data/org.ts";
import { useData } from "../../../data/state.ts";
import { useT } from "../../../i18n/index.ts";
import type { Draft } from "./draft.ts";

const NONE = "~none";
const NEW = "~new";

type PageProps = { agent: Agent; draft: Draft; edit: (patch: Partial<Draft>) => void };

/** Whether the agent's project is a company: only then it has areas. */
function useCompany(agent: Agent): boolean {
  return useData((s) =>
    agent.project_id
      ? s.projects.find((p) => p.id === agent.project_id)?.kind === "company"
      : s.base.kind === "company",
  );
}

/** An org slug for a new area or role, never one already taken. */
function freshSlug(name: string, taken: string[]): string {
  const root = slugOf(name).slice(0, 36) || "x";
  let slug = root;
  for (let n = 2; taken.includes(slug); n++) slug = `${root}-${n}`;
  return slug;
}

export function IdentityPage({
  agent,
  draft: d,
  edit,
  isSuper,
  team,
}: PageProps & { isSuper: boolean; team: Agent[] }) {
  const t = useT();
  const pid = agent.project_id ?? DEFAULT_PID;
  const org = useOrg(pid);
  const company = useCompany(agent);
  const [creating, setCreating] = useState<"area" | "role">();
  const areaName = (slug: string) => org?.areas.find((a) => a.slug === slug)?.name ?? slug;
  // Roles to pick: the company's, then the ones its team already has, then this agent's own.
  const roles = [
    ...new Set([
      ...(company ? (org?.roles.map((r) => r.name) ?? []) : []),
      ...team.map((a) => a.role).filter(Boolean),
      ...(d.role ? [d.role] : []),
    ]),
  ];
  const pickRole = (v: string | null) => {
    if (v === NEW) return setCreating("role");
    const role = !v || v === NONE ? "" : v;
    const fromOrg = company ? org?.roles.find((r) => r.name === role) : undefined;
    // A company role brings its area.
    edit({ role, ...(fromOrg?.area ? { area: fromOrg.area } : {}) });
  };

  return (
    <div className="agentedit__rows">
      {isSuper && <p className="config__hint">{t("agent.edit.superNote")}</p>}
      <SettingRow title={t("agentedit.name")} description={t("agentedit.nameHint")}>
        <Input
          aria-label={t("agentedit.name")}
          className="agentedit__control"
          value={d.name}
          onChange={(e) => edit({ name: e.currentTarget.value })}
        />
      </SettingRow>
      {!isSuper && (
        <>
          <SettingRow
            title={<span className={company ? undefined : "agentedit__struck"}>{t("agentedit.area")}</span>}
            description={company ? t("agentedit.areaHint") : t("agentedit.areaCompanyOnly")}
          >
            <Select
              label={t("agentedit.area")}
              className="agentedit__control"
              disabled={!company}
              value={d.area || NONE}
              onValueChange={(v) => (v === NEW ? setCreating("area") : edit({ area: !v || v === NONE ? "" : v }))}
              options={[
                { value: NONE, label: t("agentedit.noArea") },
                ...(org?.areas.map((a) => ({ value: a.slug, label: a.name })) ?? []),
                // An area written by hand, not in the list, is kept as it is.
                ...(d.area && !org?.areas.some((a) => a.slug === d.area) ? [{ value: d.area, label: d.area }] : []),
                { value: NEW, label: t("agentedit.newArea") },
              ]}
            />
          </SettingRow>
          <SettingRow title={t("agentedit.role")} description={t("agentedit.roleHint")}>
            <Select
              label={t("agentedit.role")}
              className="agentedit__control"
              value={d.role || NONE}
              onValueChange={pickRole}
              options={[
                { value: NONE, label: t("agentedit.noRole") },
                ...roles.map((r) => {
                  const area = company ? org?.roles.find((x) => x.name === r)?.area : undefined;
                  return { value: r, label: r, ...(area ? { hint: areaName(area) } : {}) };
                }),
                { value: NEW, label: t("agentedit.newRole") },
              ]}
            />
          </SettingRow>
          <SettingRow
            title={
              <span className="agentedit__orch">
                <Icons.Crown size={14} className={d.orchestrator ? "agentedit__crown" : undefined} />
                {t("agentedit.orchestrator")}
              </span>
            }
            description={t("agentedit.orchestratorHint")}
          >
            <Switch
              aria-label={t("agentedit.orchestrator")}
              checked={d.orchestrator}
              onCheckedChange={(orchestrator) => edit({ orchestrator })}
            />
          </SettingRow>
          <SettingRow stacked title={t("agentedit.description")} description={t("agentedit.descriptionHint")}>
            <Textarea
              aria-label={t("agentedit.description")}
              rows={3}
              value={d.description}
              placeholder={t("agentedit.descriptionPlaceholder")}
              onChange={(e) => edit({ description: e.currentTarget.value })}
            />
          </SettingRow>
        </>
      )}
      <SettingRow stacked title={t("agentedit.personality")} description={t("agentedit.personalityHint")}>
        <Textarea
          aria-label={t("agentedit.personality")}
          rows={3}
          value={d.personality}
          placeholder={t("agent.edit.personalityPlaceholder")}
          onChange={(e) => edit({ personality: e.currentTarget.value })}
        />
      </SettingRow>
      <SettingRow stacked title={t("agentedit.avatar")}>
        <div className="agentedit__blobs">
          {BLOB_NAMES.map((b) => (
            <button
              key={b}
              type="button"
              aria-pressed={d.blob === b}
              aria-label={b}
              className={`agentedit__blob${d.blob === b ? " is-on" : ""}`}
              onClick={() => edit({ blob: b })}
            >
              <AgentAvatar name={d.name} blob={b} size={32} animated={false} />
            </button>
          ))}
        </div>
      </SettingRow>
      {creating && (
        <OrgQuickCreate
          kind={creating}
          pid={pid}
          org={org ?? { areas: [], roles: [] }}
          company={company}
          area={d.area}
          onClose={() => setCreating(undefined)}
          onCreated={(patch) => {
            edit(patch);
            setCreating(undefined);
          }}
        />
      )}
    </div>
  );
}

/**
 * A quick new area or role. A company keeps it in its areas and roles for every agent; any other project only gives
 * the role to this agent.
 */
function OrgQuickCreate(props: {
  kind: "area" | "role";
  pid: string;
  org: Organization;
  company: boolean;
  area: string;
  onClose(): void;
  onCreated(patch: Partial<Draft>): void;
}) {
  const t = useT();
  const [name, setName] = useState("");
  const [about, setAbout] = useState("");
  const [area, setArea] = useState(props.area);
  const [busy, setBusy] = useState(false);
  const isArea = props.kind === "area";
  const create = async () => {
    const n = name.trim();
    if (!n) return;
    if (!props.company) return props.onCreated({ role: n });
    const { areas, roles } = props.org;
    // One the project already has by that name is taken, never written twice.
    const same = (x: { name: string }) => x.name.toLowerCase() === n.toLowerCase();
    const known = isArea ? areas.find(same) : roles.find(same);
    if (known) return props.onCreated(isArea ? { area: known.slug } : { role: known.name, ...(area ? { area } : {}) });
    setBusy(true);
    const slug = freshSlug(n, isArea ? areas.map((a) => a.slug) : roles.map((r) => r.slug));
    const desc = about.trim();
    const next: Organization = isArea
      ? { areas: [...areas, { slug, name: n, ...(desc ? { goal: desc } : {}) }], roles }
      : {
          areas,
          roles: [...roles, { slug, name: n, ...(area ? { area } : {}), ...(desc ? { description: desc } : {}) }],
        };
    const ok = await saveOrg(props.pid, next);
    setBusy(false);
    if (ok) props.onCreated(isArea ? { area: slug } : { role: n, ...(area ? { area } : {}) });
  };
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && props.onClose()}
      title={isArea ? t("agentedit.newAreaTitle") : t("agentedit.newRoleTitle")}
      {...(props.company ? { description: t("agentedit.newOrgNote") } : {})}
      footer={
        <>
          <Button variant="secondary" onClick={props.onClose}>
            {t("common.cancel")}
          </Button>
          <Button loading={busy} disabled={!name.trim()} onClick={() => void create()}>
            {t("agentedit.create")}
          </Button>
        </>
      }
    >
      <div className="taskform">
        <Field label={isArea ? t("agentedit.area") : t("agentedit.role")}>
          {(id) => (
            <Input
              id={id}
              autoFocus
              maxLength={isArea ? 60 : 80}
              value={name}
              onChange={(e) => setName(e.currentTarget.value)}
              onKeyDown={(e) => e.key === "Enter" && void create()}
            />
          )}
        </Field>
        {props.company && (
          <Field label={isArea ? t("agentedit.newAreaGoal") : t("agentedit.newRoleDescription")}>
            {(id) => <Input id={id} maxLength={300} value={about} onChange={(e) => setAbout(e.currentTarget.value)} />}
          </Field>
        )}
        {props.company && !isArea && props.org.areas.length > 0 && (
          <Field label={t("agentedit.area")}>
            <Select
              label={t("agentedit.area")}
              value={area || NONE}
              onValueChange={(v) => setArea(!v || v === NONE ? "" : v)}
              options={[
                { value: NONE, label: t("agentedit.noArea") },
                ...props.org.areas.map((a) => ({ value: a.slug, label: a.name })),
              ]}
            />
          </Field>
        )}
      </div>
    </Dialog>
  );
}

/** Past this, instructions weigh on every model call: the editor says so (rules/PROMPT_SIZE.md). */
const PROMPT_LONG_CHARS = 4_000;

export function PromptPage({ draft: d, edit, isSuper }: PageProps & { isSuper: boolean }) {
  const t = useT();
  const chars = d.prompt.length;
  const size = { chars: chars.toLocaleString(), tokens: Math.round(chars / 4).toLocaleString() };
  return (
    <div className="agentedit__prompt">
      <Textarea
        aria-label={isSuper ? t("agent.edit.superPrompt") : t("agentedit.page.prompt")}
        className="agentedit__prompttext"
        rows={20}
        value={d.prompt}
        onChange={(e) => edit({ prompt: e.currentTarget.value })}
      />
      <span className={`agentedit__hint${chars > PROMPT_LONG_CHARS ? " is-long" : ""}`} role="status">
        {t(chars > PROMPT_LONG_CHARS ? "agentedit.promptLong" : "agentedit.promptSize", size)}
      </span>
      <span className="agentedit__hint">{isSuper ? t("agent.edit.superPromptHint") : t("agentedit.promptSave")}</span>
    </div>
  );
}

export function TeamPage({
  agent,
  draft: d,
  edit,
  isSuper,
  team,
  file,
}: PageProps & { isSuper: boolean; team: Agent[]; file: string | undefined }) {
  const t = useT();
  // A parent names a project agent by its slug and a global one (which has none) by its id.
  const keyOf = (a: Agent) => a.slug ?? (a.project_id ? undefined : a.id);
  // Its own reports cannot become its parent: the core refuses loops, the list does not offer them.
  const below = new Set<string>();
  const walk = (key: string | undefined) => {
    for (const a of team) {
      const k = keyOf(a);
      if (key && a.parent === key && k && !below.has(k)) {
        below.add(k);
        walk(k);
      }
    }
  };
  walk(keyOf(agent));
  const parents = team.filter(
    (a) => a.kind !== "secretary" && a.id !== agent.id && keyOf(a) && !below.has(keyOf(a) as string),
  );
  return (
    <div className="agentedit__rows">
      <SettingRow title={t("agentedit.model")} description={t("agentedit.modelHint")}>
        <AgentModelPicker agent={agent} />
      </SettingRow>
      {!isSuper && (
        <SettingRow title={t("agentedit.parent")} description={t("agentedit.parentHint")}>
          <Select
            label={t("agentedit.parent")}
            className="agentedit__control"
            value={d.parent || NONE}
            onValueChange={(v) => edit({ parent: !v || v === NONE ? "" : v })}
            options={[
              { value: NONE, label: t("team.parent.none") },
              ...parents.map((p) => ({ value: keyOf(p) ?? "", label: p.name, ...(p.role ? { hint: p.role } : {}) })),
            ]}
          />
        </SettingRow>
      )}
      {file && (
        <SettingRow title={t("agentedit.file")} description={t("agentedit.fileHint")}>
          <code className="agentedit__mono">{file}</code>
        </SettingRow>
      )}
    </div>
  );
}
