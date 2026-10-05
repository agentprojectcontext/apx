// A company project's areas and roles: a card per area with its roles, then the general roles. Agents take an area
// and a role from here (the agent editor offers them); the agents of the project read them in their prompt.
import type { Organization } from "@apx/protocol";
import { Button, Card, Dialog, EmptyState, Field, IconButton, Icons, Input, Select, Skeleton, Textarea } from "@apx/ui";
import { useMemo, useState } from "react";
import { slugOf } from "../common/slug.ts";
import { inProject, type ProjectEntry } from "../data/identity.ts";
import { saveOrg, useOrg } from "../data/org.ts";
import { useData } from "../data/state.ts";
import { useT } from "../i18n/index.ts";

type Area = Organization["areas"][number];
type Role = Organization["roles"][number];
const GENERAL = "~general";

export function ProjectOrg({ project }: { project: ProjectEntry }) {
  const t = useT();
  const org = useOrg(project.id);
  const agents = useData((s) => s.agents);
  const [area, setArea] = useState<Area | "new">();
  const [role, setRole] = useState<{ role?: Role; area?: string }>();
  const team = useMemo(() => Object.values(agents).filter((a) => inProject(a, project.id)), [agents, project.id]);

  if (!org) return <Skeleton shape="block" height={200} />;
  const rolesOf = (slug: string | undefined) => org.roles.filter((r) => (slug ? r.area === slug : !r.area));
  const general = rolesOf(undefined);
  const chips = (roles: Role[], areaSlug?: string) => (
    <div className="org__roles">
      {roles.map((r) => (
        <Button key={r.slug} size="sm" variant="secondary" onClick={() => setRole({ role: r })}>
          {r.name}
        </Button>
      ))}
      <Button
        size="sm"
        variant="ghost"
        leadingIcon={<Icons.Plus size={12} />}
        onClick={() => setRole({ area: areaSlug })}
      >
        {t("org.addRole")}
      </Button>
    </div>
  );

  return (
    <div className="team org">
      <div className="team__head">
        <div className="team__titles">
          <div className="team__title">{t("project.tab.org")}</div>
          <div className="team__note">{t("org.note")}</div>
        </div>
        <Button size="sm" variant="secondary" leadingIcon={<Icons.Plus size={14} />} onClick={() => setRole({})}>
          {t("org.role")}
        </Button>
        <Button size="sm" leadingIcon={<Icons.Plus size={14} />} onClick={() => setArea("new")}>
          {t("org.area")}
        </Button>
      </div>
      {org.areas.length === 0 && org.roles.length === 0 ? (
        <EmptyState
          variant="dashed"
          size="lg"
          icon={<Icons.Building2 />}
          title={t("org.empty")}
          action={
            <Button size="sm" leadingIcon={<Icons.Plus size={14} />} onClick={() => setArea("new")}>
              {t("org.addArea")}
            </Button>
          }
        >
          {t("org.emptyHint")}
        </EmptyState>
      ) : (
        <div className="org__grid">
          {org.areas.map((a) => (
            <Card
              key={a.slug}
              className="org__area"
              title={a.name}
              description={a.goal}
              aside={
                <span className="org__aside">
                  <span className="org__count">
                    {t("org.agents", { n: team.filter((x) => x.area === a.slug).length })}
                  </span>
                  <IconButton
                    size="sm"
                    label={t("org.editArea", { name: a.name })}
                    icon={<Icons.Pencil size={13} />}
                    onClick={() => setArea(a)}
                  />
                </span>
              }
            >
              {chips(rolesOf(a.slug), a.slug)}
            </Card>
          ))}
          {general.length > 0 && (
            <Card className="org__area" title={t("org.general")} description={t("org.generalHint")}>
              {chips(general)}
            </Card>
          )}
        </div>
      )}
      {area && (
        <AreaDialog
          project={project.id}
          org={org}
          area={area === "new" ? undefined : area}
          onClose={() => setArea(undefined)}
        />
      )}
      {role && (
        <RoleDialog
          project={project.id}
          org={org}
          role={role.role}
          area={role.area}
          onClose={() => setRole(undefined)}
        />
      )}
    </div>
  );
}

/** A slug for a new entry: from its name, made unique among the ones there are. */
function freshSlug(name: string, taken: string[]): string {
  const base = slugOf(name).slice(0, 36) || "item";
  let slug = base;
  for (let i = 2; taken.includes(slug); i++) slug = `${base}-${i}`;
  return slug;
}

function AreaDialog({
  project,
  org,
  area,
  onClose,
}: {
  project: string;
  org: Organization;
  area: Area | undefined;
  onClose(): void;
}) {
  const t = useT();
  const [name, setName] = useState(area?.name ?? "");
  const [goal, setGoal] = useState(area?.goal ?? "");
  const [busy, setBusy] = useState(false);
  const write = async (next: Organization) => {
    setBusy(true);
    const ok = await saveOrg(project, next);
    setBusy(false);
    if (ok) onClose();
  };
  const save = () => {
    const entry: Area = {
      slug:
        area?.slug ??
        freshSlug(
          name,
          org.areas.map((a) => a.slug),
        ),
      name: name.trim(),
      ...(goal.trim() ? { goal: goal.trim() } : {}),
    };
    void write({
      ...org,
      areas: area ? org.areas.map((a) => (a.slug === area.slug ? entry : a)) : [...org.areas, entry],
    });
  };
  return (
    <Dialog
      open
      title={area ? t("org.editArea", { name: area.name }) : t("org.newArea")}
      onOpenChange={(o) => !o && !busy && onClose()}
      footer={
        <>
          {area && (
            <Button
              variant="danger"
              disabled={busy}
              onClick={() => void write({ ...org, areas: org.areas.filter((a) => a.slug !== area.slug) })}
            >
              {t("org.deleteArea")}
            </Button>
          )}
          <Button variant="secondary" disabled={busy} onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button loading={busy} disabled={!name.trim()} onClick={save}>
            {t("common.save")}
          </Button>
        </>
      }
    >
      <div className="taskform">
        <Field label={t("org.name")}>
          {(id) => (
            <Input id={id} autoFocus value={name} maxLength={60} onChange={(e) => setName(e.currentTarget.value)} />
          )}
        </Field>
        <Field label={t("org.goal")} hint={t("org.goalHint")}>
          {(id) => (
            <Textarea id={id} rows={2} value={goal} maxLength={300} onChange={(e) => setGoal(e.currentTarget.value)} />
          )}
        </Field>
        {area && <p className="org__hint">{t("org.deleteAreaHint")}</p>}
      </div>
    </Dialog>
  );
}

function RoleDialog({
  project,
  org,
  role,
  area: start,
  onClose,
}: {
  project: string;
  org: Organization;
  role: Role | undefined;
  area: string | undefined;
  onClose(): void;
}) {
  const t = useT();
  const [name, setName] = useState(role?.name ?? "");
  const [area, setArea] = useState(role?.area ?? start ?? GENERAL);
  const [description, setDescription] = useState(role?.description ?? "");
  const [busy, setBusy] = useState(false);
  const write = async (next: Organization) => {
    setBusy(true);
    const ok = await saveOrg(project, next);
    setBusy(false);
    if (ok) onClose();
  };
  const save = () => {
    const entry: Role = {
      slug:
        role?.slug ??
        freshSlug(
          name,
          org.roles.map((r) => r.slug),
        ),
      name: name.trim(),
      ...(area !== GENERAL ? { area } : {}),
      ...(description.trim() ? { description: description.trim() } : {}),
    };
    void write({
      ...org,
      roles: role ? org.roles.map((r) => (r.slug === role.slug ? entry : r)) : [...org.roles, entry],
    });
  };
  return (
    <Dialog
      open
      title={role ? t("org.editRole", { name: role.name }) : t("org.newRole")}
      onOpenChange={(o) => !o && !busy && onClose()}
      footer={
        <>
          {role && (
            <Button
              variant="danger"
              disabled={busy}
              onClick={() => void write({ ...org, roles: org.roles.filter((r) => r.slug !== role.slug) })}
            >
              {t("org.deleteRole")}
            </Button>
          )}
          <Button variant="secondary" disabled={busy} onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button loading={busy} disabled={!name.trim()} onClick={save}>
            {t("common.save")}
          </Button>
        </>
      }
    >
      <div className="taskform">
        <Field label={t("org.name")}>
          {(id) => (
            <Input id={id} autoFocus value={name} maxLength={80} onChange={(e) => setName(e.currentTarget.value)} />
          )}
        </Field>
        <Field label={t("team.area")}>
          <Select
            label={t("team.area")}
            value={area}
            onValueChange={(v) => setArea(v ?? GENERAL)}
            options={[
              { value: GENERAL, label: t("org.general") },
              ...org.areas.map((a) => ({ value: a.slug, label: a.name })),
            ]}
          />
        </Field>
        <Field label={t("agent.edit.description")}>
          {(id) => (
            <Textarea
              id={id}
              rows={2}
              value={description}
              maxLength={500}
              onChange={(e) => setDescription(e.currentTarget.value)}
            />
          )}
        </Field>
      </div>
    </Dialog>
  );
}
