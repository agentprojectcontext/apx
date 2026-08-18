import { useState } from "react";
import { Dialog, Button } from "../ui";
import { t } from "../../i18n";

// Reusable confirm dialog for destructive/executing actions (project rule:
// never native confirm()). Shows a loading state while the action runs.
export function ConfirmDialog({
  open,
  onClose,
  onConfirm,
  title,
  description,
  confirmLabel,
  destructive = true,
  testId,
}: {
  open: boolean;
  onClose: () => void;
  onConfirm: () => Promise<void> | void;
  title: string;
  description?: string;
  confirmLabel?: string;
  destructive?: boolean;
  /** Put on the confirm button — the one a spec has to click. */
  testId?: string;
}) {
  const [busy, setBusy] = useState(false);
  const run = async () => {
    setBusy(true);
    try {
      await onConfirm();
      onClose();
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={title}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>{t("common.cancel")}</Button>
          <Button variant={destructive ? "destructive" : "primary"} onClick={() => void run()} loading={busy} data-testid={testId}>
            {confirmLabel ?? t("common.confirm")}
          </Button>
        </>
      }
    >
      <p className="text-sm text-muted-foreground">{description}</p>
    </Dialog>
  );
}
