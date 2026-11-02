import type { Task } from "@apx/protocol";
import { Button, Dialog } from "@apx/ui";
import { useRef, useState } from "react";
import { acceptReviewedTasks } from "../data/tasks.ts";
import { useT } from "../i18n/index.ts";

export function AcceptProposals({ tasks, onClose }: { tasks: Task[]; onClose(): void }) {
  const t = useT();
  const [busy, setBusy] = useState(false);
  const pending = useRef(false);
  const accept = async () => {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    try {
      await acceptReviewedTasks(tasks);
      onClose();
    } finally {
      pending.current = false;
      setBusy(false);
    }
  };
  return (
    <Dialog
      open
      size="sm"
      title={t(tasks.length === 1 ? "tasks.acceptAll.titleOne" : "tasks.acceptAll.title")}
      description={t(tasks.length === 1 ? "tasks.acceptAll.bodyOne" : "tasks.acceptAll.body", { n: tasks.length })}
      closeLabel={t("common.close")}
      onOpenChange={(open) => !open && !pending.current && onClose()}
      footer={
        <>
          <Button autoFocus variant="secondary" disabled={busy} onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button loading={busy} onClick={() => void accept()}>
            {t(tasks.length === 1 ? "tasks.acceptAll.confirmOne" : "tasks.acceptAll.confirm", { n: tasks.length })}
          </Button>
        </>
      }
    />
  );
}
