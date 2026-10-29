// Leaving the editor with unsaved edits, out of it or to a table in Tables: keep editing, drop them, or save a draft
// first and go.
import { Button, Dialog } from "@apx/ui";
import { useState } from "react";
import { useT } from "../i18n/index.ts";

/** Where leaving goes once the owner keeps or drops unsaved edits; `away` asks only when there are some. */
export function useLeave(dirty: boolean, onClose: () => void, before: () => void) {
  const [leaving, setLeaving] = useState(false);
  const [to, setTo] = useState<{ go: () => void }>();
  const away = (go: () => void) => {
    before();
    if (!dirty) return go();
    setTo({ go });
    setLeaving(true);
  };
  const leave = () => (to ?? { go: onClose }).go();
  const openChange = (open: boolean) => {
    setLeaving(open);
    if (!open) setTo(undefined);
  };
  return { leaving, away, leave, openChange };
}

export function LeaveDialog({
  open,
  onOpenChange,
  locked,
  busy,
  leave,
  saveDraft,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** An agent's draft under review: it can't be saved as the owner's draft from here. */
  locked: boolean;
  busy: boolean;
  leave: () => void;
  saveDraft: () => Promise<unknown>;
}) {
  const t = useT();
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={t("flow.ed.discardTitle")}
      footer={
        <>
          <Button variant="secondary" onClick={() => onOpenChange(false)}>
            {t("flow.ed.keep")}
          </Button>
          <Button variant="danger" onClick={leave}>
            {t("flow.ed.discard")}
          </Button>
          {!locked && (
            <Button
              disabled={busy}
              onClick={() =>
                void saveDraft().then((ok) => {
                  if (ok) leave();
                  onOpenChange(false);
                })
              }
            >
              {t("flow.ed.saveDraft")}
            </Button>
          )}
        </>
      }
    >
      {t(locked ? "flow.ed.discardBody" : "flow.ed.leaveDraftBody")}
    </Dialog>
  );
}
