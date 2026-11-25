import { Button, Icons } from "@apx/ui";
import { useState } from "react";
import { client } from "../data/client.ts";
import type { ProjectEntry } from "../data/identity.ts";
import { notify } from "../data/notices.ts";
import { useT } from "../i18n/index.ts";
import { OverviewCard } from "./OverviewCards.tsx";

/** Offered while a project's agents and settings are still in `.apc/`: one press moves them to `.agent/`. */
export function AgentFolderCard({ project }: { project: ProjectEntry }) {
  const t = useT();
  const [busy, setBusy] = useState(false);
  if (!project.legacyFolder) return null;
  const move = async () => {
    setBusy(true);
    try {
      const r = await client.call("projects.move_folder", { project: project.id });
      if (r.conflicts.length) notify(t("folder.conflicts", { files: r.conflicts.join(", ") }), "error");
      else notify(t(r.kept.length ? "folder.kept" : "folder.moved"), "info");
    } catch (e) {
      notify(e instanceof Error ? e.message : String(e), "error");
    } finally {
      setBusy(false);
    }
  };
  return (
    <OverviewCard title={t("folder.title")} mark>
      <div className="projside__helper">
        <p className="projside__hint">{t("folder.body")}</p>
        <Button
          size="sm"
          variant="secondary"
          leadingIcon={<Icons.FolderOpen size={14} />}
          loading={busy}
          onClick={() => void move()}
        >
          {t("folder.move")}
        </Button>
      </div>
    </OverviewCard>
  );
}
