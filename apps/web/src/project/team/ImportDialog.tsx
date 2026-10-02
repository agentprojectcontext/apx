import type { Agent, AgentTemplate, TeamTemplate } from "@apx/protocol";
import { Badge, Button, Checkbox, Dialog, EmptyState, Icons, Skeleton, Switch } from "@apx/ui";
import { useEffect, useMemo, useState } from "react";
import { notify } from "../../data/notices.ts";
import { installTemplates, loadTemplates } from "../../data/team.ts";
import { useT } from "../../i18n/index.ts";

type Templates = { teams: TeamTemplate[]; singles: AgentTemplate[] };

/**
 * Import teams or single agents into a project. When the project already has a top agent and the pick brings a lead
 * of its own, the new lead hangs under the current one by default, so the project keeps one tree.
 */
export function ImportDialog({
  projectId,
  top,
  team,
  onClose,
}: {
  projectId: string;
  /** The project's current top agent (its orchestrator), if any. */
  top: Agent | undefined;
  team: Agent[];
  onClose(): void;
}) {
  const t = useT();
  const [data, setData] = useState<Templates>();
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [open, setOpen] = useState<string>();
  const [hang, setHang] = useState(true);
  const [busy, setBusy] = useState(false);
  const taken = useMemo(() => new Set(team.flatMap((a) => (a.slug ? [a.slug] : []))), [team]);

  useEffect(() => {
    void loadTemplates().then((r) => setData(r ?? { teams: [], singles: [] }));
  }, []);

  const all = useMemo(
    () => new Map([...(data?.teams.flatMap((x) => x.members) ?? []), ...(data?.singles ?? [])].map((m) => [m.id, m])),
    [data],
  );
  const chosen = [...picked].flatMap((id) => (all.get(id) ? [all.get(id) as AgentTemplate] : []));
  const bringsLead = chosen.some((m) => m.lead || !m.parent || !chosen.some((c) => c.slug === m.parent));
  const toggle = (ids: string[], on: boolean) =>
    setPicked((s) => {
      const next = new Set(s);
      for (const id of ids) on ? next.add(id) : next.delete(id);
      return next;
    });

  const install = async () => {
    setBusy(true);
    const r = await installTemplates(projectId, [...picked], hang && bringsLead ? top?.slug : undefined);
    setBusy(false);
    if (!r) return;
    notify(
      r.skipped.length
        ? t("team.import.doneSkipped", { n: r.installed, skipped: r.skipped.length })
        : t("team.import.done", { n: r.installed }),
      "info",
    );
    onClose();
  };

  return (
    <Dialog
      open
      size="xl"
      onOpenChange={(o) => !o && onClose()}
      title={t("team.import.title")}
      description={t("team.import.lead")}
      footer={
        <>
          {top?.slug && bringsLead && chosen.length > 0 && (
            <div className="teamimport__hang">
              <Switch
                size="sm"
                checked={hang}
                onCheckedChange={setHang}
                label={t("team.import.hang", { name: top.name })}
              />
            </div>
          )}
          <Button variant="secondary" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button disabled={!picked.size} loading={busy} onClick={() => void install()}>
            {t("team.import.install", { n: picked.size })}
          </Button>
        </>
      }
    >
      {!data ? (
        <div className="teamimport__loading">
          <Skeleton height={72} />
          <Skeleton height={72} />
        </div>
      ) : !data.teams.length && !data.singles.length ? (
        <EmptyState variant="dashed" size="sm" icon={<Icons.Users />}>
          {t("team.import.empty")}
        </EmptyState>
      ) : (
        <div className="teamimport">
          {data.teams.length > 0 && <h3 className="teamimport__label">{t("team.import.teams")}</h3>}
          {data.teams.map((tm) => {
            const free = tm.members.filter((m) => !taken.has(m.slug)).map((m) => m.id);
            const on = free.filter((id) => picked.has(id)).length;
            return (
              <section key={tm.id} className="teamimport__team">
                <header className="teamimport__teamhead">
                  <Icons.Users size={16} />
                  <div className="teamimport__teamtitles">
                    <div className="teamimport__teamname">
                      {tm.name}
                      {tm.source === "v1" && <Badge>{t("team.import.fromV1")}</Badge>}
                    </div>
                    {tm.description && <p className="teamimport__teamdesc">{tm.description}</p>}
                  </div>
                  <Button size="sm" variant="ghost" onClick={() => toggle(free, on < free.length)}>
                    {on < free.length ? t("team.import.selectAll") : t("team.import.clear")}
                  </Button>
                </header>
                <ul className="teamimport__members">
                  {tm.members.map((m) => (
                    <Member
                      key={m.id}
                      m={m}
                      taken={taken.has(m.slug)}
                      on={picked.has(m.id)}
                      open={open === m.id}
                      onOpen={() => setOpen(open === m.id ? undefined : m.id)}
                      onToggle={(v) => toggle([m.id], v)}
                    />
                  ))}
                </ul>
                {top?.slug && tm.members.some((m) => m.lead && picked.has(m.id)) && (
                  <p className="teamimport__warn">
                    <Icons.TriangleAlert size={14} />
                    {hang
                      ? t("team.import.warnHang", { top: top.name })
                      : t("team.import.warnRoots", { top: top.name })}
                  </p>
                )}
              </section>
            );
          })}
          {data.singles.length > 0 && <h3 className="teamimport__label">{t("team.import.singles")}</h3>}
          <div className="teamimport__grid">
            {data.singles.map((m) => {
              const isTaken = taken.has(m.slug);
              return (
                <div
                  key={m.id}
                  className={`teamimport__card${picked.has(m.id) ? " is-on" : ""}${isTaken ? " is-taken" : ""}`}
                >
                  <Checkbox
                    checked={picked.has(m.id)}
                    disabled={isTaken}
                    onCheckedChange={(v) => toggle([m.id], v)}
                    label={
                      <span className="teamimport__cardname">
                        {m.name} <code>{m.slug}</code>
                      </span>
                    }
                    description={
                      <span className="teamimport__carddesc">
                        {isTaken ? t("team.import.taken") : m.description || m.role}
                      </span>
                    }
                  />
                </div>
              );
            })}
          </div>
        </div>
      )}
    </Dialog>
  );
}

function Member(props: {
  m: AgentTemplate;
  taken: boolean;
  on: boolean;
  open: boolean;
  onOpen(): void;
  onToggle(on: boolean): void;
}) {
  const t = useT();
  const { m } = props;
  return (
    <li className={props.taken ? "teamimport__member is-taken" : "teamimport__member"}>
      <Checkbox checked={props.on} disabled={props.taken} onCheckedChange={props.onToggle} />
      <button
        type="button"
        className="teamimport__eye"
        aria-label={t("team.import.preview", { name: m.name })}
        aria-expanded={props.open}
        onClick={props.onOpen}
      >
        <Icons.Eye size={14} />
      </button>
      <span className="teamimport__membername">{m.name}</span>
      <code className="teamimport__slug">{m.slug}</code>
      {m.lead && (
        <span className="teamimport__leadtag">
          <Icons.Crown size={12} />
          {t("team.orchestrator")}
        </span>
      )}
      {props.taken && <span className="teamimport__muted">{t("team.import.taken")}</span>}
      {props.open && (
        <p className="teamimport__preview">
          <strong>{m.role}</strong>
          {m.description ? ` · ${m.description}` : ""}
        </p>
      )}
    </li>
  );
}
