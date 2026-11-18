import { type ReactNode, useState } from "react";
import { Button } from "./Button";
import { Dialog } from "./Dialog";

export interface ConfirmDialogProps {
  /** What is about to happen, as a question ("Remove the claude-plugins-official catalog?"). */
  title: ReactNode;
  /** What it leaves behind, or what goes with it. */
  description?: ReactNode;
  /** The action's own word ("Remove"), never "OK". */
  confirmLabel: string;
  cancelLabel: string;
  closeLabel?: string;
  /** Red, for something that deletes or cannot be undone from here. */
  danger?: boolean;
  /** Runs while the button spins; the dialog closes when it ends. */
  onConfirm(): Promise<unknown> | unknown;
  onClose(): void;
}

/** Asks before an action that removes or changes something for good: its question, then Cancel or its own word. */
export function ConfirmDialog({
  title,
  description,
  confirmLabel,
  cancelLabel,
  closeLabel,
  danger = true,
  onConfirm,
  onClose,
}: ConfirmDialogProps) {
  const [busy, setBusy] = useState(false);
  const confirm = async () => {
    setBusy(true);
    try {
      await onConfirm();
    } finally {
      setBusy(false);
      onClose();
    }
  };
  return (
    <Dialog
      open
      size="sm"
      title={title}
      description={description}
      {...(closeLabel ? { closeLabel } : {})}
      onOpenChange={(o) => !o && !busy && onClose()}
      footer={
        <>
          <Button variant="secondary" disabled={busy} onClick={onClose}>
            {cancelLabel}
          </Button>
          <Button variant={danger ? "danger" : "primary"} loading={busy} onClick={() => void confirm()}>
            {confirmLabel}
          </Button>
        </>
      }
    />
  );
}
