import type { Agent } from "@apx/protocol";
import { AgentAvatar, Button, Dialog, Icons, ProjectTile } from "@apx/ui";
import { useEffect, useMemo, useState } from "react";
import { blobOf, DEFAULT_PID, projectInitial, projectTone } from "../../data/identity.ts";
import { useData } from "../../data/state.ts";
import { deleteAgentForGood, loadArchivedAgents, restoreAgent } from "../../data/team.ts";
import { useT } from "../../i18n/index.ts";

/**
 * Archived agents: one project's (`project`, "" for the global ones) or every project's. Each can come back to its
 * team or be deleted for good. Nothing shows while there are none.
 */
export function ArchivedAgents({ project }: { project?: string | undefined }) {
  const t = useT();
  const active = useData((s) => s.agents);
  const projects = useData((s) => s.projects);
  const [all, setAll] = useState<Agent[]>([]);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<string>();
  const [deleting, setDeleting] = useState<Agent>();
  // Archiving one elsewhere changes the active list: read the archived ones again then.
  // biome-ignore lint/correctness/useExhaustiveDependencies: `active` is the signal to reload, not a value read here
  useEffect(() => {
    void loadArchivedAgents().then(setAll);
  }, [active]);
  const list = useMemo(
    () => all.filter((a) => project === undefined || (a.project_id ?? "") === project),
    [all, project],
  );
  if (!list.length) return null;

  const restore = async (a: Agent) => {
    setBusy(a.id);
    if (await restoreAgent(a)) setAll((l) => l.filter((x) => x.id !== a.id));
    setBusy(undefined);
  };
  const remove = async (a: Agent) => {
    setBusy(a.id);
    if (await deleteAgentForGood(a)) {
      setAll((l) => l.filter((x) => x.id !== a.id));
      setDeleting(undefined);
    }
    setBusy(undefined);
  };

  return (
    <section className="archived" aria-label={t("archived.title")}>
      <button type="button" className="archived__head" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
        {open ? <Icons.ChevronDown size={14} /> : <Icons.ChevronRight size={14} />}
        <Icons.Archive size={14} />
        <span>{t("archived.title")}</span>
        <span className="archived__count">{list.length}</span>
      </button>
      {open && (
        <>
          <p className="archived__note">{t("archived.note")}</p>
          <ul className="archived__list">
            {list.map((a) => {
              const where = projects.find((p) => p.id === a.project_id);
              return (
                <li key={a.id} className="archived__row">
                  <AgentAvatar name={a.name} blob={blobOf(a)} size={28} animated={false} />
                  <span className="archived__name">
                    <b>{a.name}</b>
                    <span className="archived__role">
                      {project === undefined && (
                        <>
                          <ProjectTile
                            size={12}
                            tone={projectTone(where?.id ?? DEFAULT_PID)}
                            initial={projectInitial(where?.name ?? "Default")}
                          />
                          {where?.name ?? t("agents.global")}
                          {a.role ? " · " : ""}
                        </>
                      )}
                      {a.role}
                    </span>
                  </span>
                  <Button
                    size="sm"
                    variant="secondary"
                    leadingIcon={<Icons.RotateCcw size={14} />}
                    loading={busy === a.id && !deleting}
                    disabled={Boolean(busy)}
                    onClick={() => void restore(a)}
                  >
                    {t("archived.restore")}
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    leadingIcon={<Icons.Trash2 size={14} />}
                    disabled={Boolean(busy)}
                    onClick={() => setDeleting(a)}
                  >
                    {t("archived.delete")}
                  </Button>
                </li>
              );
            })}
          </ul>
        </>
      )}
      {deleting && (
        <Dialog
          open
          title={t("archived.deleteTitle", { name: deleting.name })}
          description={t("archived.deleteBody")}
          onOpenChange={(o) => !o && !busy && setDeleting(undefined)}
          footer={
            <>
              <Button variant="secondary" disabled={Boolean(busy)} onClick={() => setDeleting(undefined)}>
                {t("common.cancel")}
              </Button>
              <Button variant="danger" loading={busy === deleting.id} onClick={() => void remove(deleting)}>
                {t("archived.delete")}
              </Button>
            </>
          }
        />
      )}
    </section>
  );
}
