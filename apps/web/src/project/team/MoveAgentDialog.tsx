import type { Agent, Result } from "@apx/protocol";
import { Button, Checkbox, Dialog, Field } from "@apx/ui";
import { useState } from "react";
import { ProjectSelect } from "../../common/ProjectSelect.tsx";
import { client } from "../../data/client.ts";
import { useData } from "../../data/state.ts";
import { useT } from "../../i18n/index.ts";
import { go } from "../../shell/nav.ts";
import { MigrationFiles } from "./MigrationFiles.tsx";
import { migrationBlocker } from "./migration.ts";
import "../../styles/agent-move.css";

type Preview = Result<"agents.migration_preview">;

export function MoveAgentDialog({ agent, onClose }: { agent: Agent; onClose(): void }) {
  const t = useT();
  const projects = useData((s) => s.projects);
  const destinations = projects.filter((p) => p.id !== agent.project_id && p.registered !== false && p.path);
  const [destination, setDestination] = useState("");
  const [paths, setPaths] = useState<string[]>([]);
  const [preview, setPreview] = useState<Preview>();
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const review = async () => {
    setBusy(true);
    setFailed(false);
    try {
      setPreview(await client.call("agents.migration_preview", { agent: agent.id, destination, paths }));
      setConfirmed(false);
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  };
  const move = async () => {
    if (!preview || preview.blockers.length || !confirmed) return;
    setBusy(true);
    setFailed(false);
    try {
      const result = await client.call("agents.migrate", {
        agent: agent.id,
        destination: preview.destination,
        paths: preview.paths,
        id: preview.id,
        revision: preview.revision,
      });
      if (result.state !== "committed") throw new Error("Move was restored");
      try {
        sessionStorage.setItem(
          "apx.agentMoved",
          JSON.stringify({ name: agent.name, destination: preview.destination_name }),
        );
      } catch {
        /* Storage restrictions must not turn a completed move into a retry. */
      }
      // Reload drops cached source-project chats, messages and permissions after the move.
      go.project(preview.destination, "team");
      window.location.reload();
    } catch {
      setFailed(true);
      setPreview(undefined);
      setConfirmed(false);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog
      open
      size="lg"
      title={t("team.move.title", { name: agent.name })}
      description={t("team.move.lead")}
      closeLabel={t("common.close")}
      onOpenChange={(open) => {
        if (!open && !busy) onClose();
      }}
      footer={
        <>
          <Button
            variant="secondary"
            disabled={busy}
            onClick={
              preview
                ? () => {
                    setPreview(undefined);
                    setConfirmed(false);
                  }
                : onClose
            }
          >
            {t(preview ? "team.move.back" : "common.cancel")}
          </Button>
          <Button
            loading={busy}
            disabled={preview ? !confirmed || preview.blockers.length > 0 : !destination}
            onClick={() => void (preview ? move() : review())}
          >
            {t(preview ? "team.move.apply" : "team.move.review")}
          </Button>
        </>
      }
    >
      <div className="agentmove" aria-busy={busy}>
        {failed && (
          <p role="alert" className="agentmove__warning">
            {t("team.move.error")}
          </p>
        )}
        {preview ? (
          <MigrationReview preview={preview} />
        ) : (
          <div inert={busy}>
            <Field label={t("team.move.destination")}>
              <ProjectSelect
                label={t("team.move.destination")}
                value={destination}
                onChange={setDestination}
                options={destinations.map((p) => ({ id: p.id, label: p.name }))}
              />
            </Field>
            {!destinations.length && <p>{t("team.move.noDestination")}</p>}
            {agent.project_id && <MigrationFiles project={agent.project_id} paths={paths} onChange={setPaths} />}
          </div>
        )}
        {preview && !preview.blockers.length && (
          <Checkbox
            label={t("team.move.confirm", { name: agent.name, destination: preview.destination_name })}
            checked={confirmed}
            disabled={busy}
            onCheckedChange={(v) => setConfirmed(v === true)}
          />
        )}
      </div>
    </Dialog>
  );
}

function MigrationReview({ preview: p }: { preview: Preview }) {
  const t = useT();
  const counts = ["tasks", "shared_tasks", "threads", "memories", "routines", "surfaces", "media"] as const;
  return (
    <section>
      <h3>{t("team.move.route", { source: p.source_name, destination: p.destination_name })}</h3>
      <dl className="agentmove__counts">
        {counts.map((key) => (
          <div key={key}>
            <dt>{t(`team.move.count.${key}`)}</dt>
            <dd>{p[key].length}</dd>
          </div>
        ))}
        <div>
          <dt>{t("team.move.files")}</dt>
          <dd>{p.files.length}</dd>
        </div>
      </dl>
      <p>{t("team.move.history")}</p>
      {(p.detached_threads.length > 0 || p.detached_tasks.length > 0) && (
        <p>{t("team.move.stays", { chats: p.detached_threads.length, tasks: p.detached_tasks.length })}</p>
      )}
      <p>{t("team.move.permissions", { n: p.permissions_reset })}</p>
      {p.destination_agents.length > 0 && (
        <p>{t("team.move.destinationTeam", { names: p.destination_agents.map((a) => a.name).join(", ") })}</p>
      )}
      {p.detached_agents.length > 0 && (
        <p>{t("team.move.children", { names: p.detached_agents.map((a) => a.name).join(", ") })}</p>
      )}
      {p.connections_left.length > 0 && <p>{t("team.move.connections", { names: p.connections_left.join(", ") })}</p>}
      {p.binding_changes.length > 0 && (
        <p>
          {t("team.move.bindings", {
            names: p.binding_changes
              .map((change) => `${change.connection} (${change.variables.join(", ")})`)
              .join("; "),
          })}
        </p>
      )}
      {p.files.length > 0 && (
        <details>
          <summary>{t("team.move.fileList")}</summary>
          <ul className="agentmove__paths">
            {p.files.map((f) => (
              <li key={`${f.kind}:${f.from}`}>
                <span>
                  {f.from} → {f.to}
                </span>
                <span>{f.bytes.toLocaleString()} B</span>
              </li>
            ))}
          </ul>
        </details>
      )}
      {p.blockers.length > 0 && (
        <div role="alert" className="agentmove__warning">
          <h4>{t("team.move.blocked")}</h4>
          <ul>
            {[...new Set(p.blockers.map(migrationBlocker))].map((key) => (
              <li key={key}>{t(`team.move.blocker.${key}`)}</li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
