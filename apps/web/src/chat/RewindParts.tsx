// The parts of going back in a chat that show only once the owner starts it: the field that edits their message and
// the question before later messages are removed.
import "../styles/chat-cards.css";
import { Button, Dialog, Textarea } from "@apx/ui";
import { useState } from "react";
import { useT } from "../i18n/index.ts";

/** Asks before going back removes `count` later messages; `go` does it. */
export function RewindConfirm({
  count,
  go,
  onClose,
}: {
  count: number;
  go: () => Promise<boolean>;
  onClose: () => void;
}) {
  const t = useT();
  const [busy, setBusy] = useState(false);
  return (
    <Dialog
      open
      title={t("rewind.confirmTitle")}
      description={t("rewind.confirmBody", { count })}
      onOpenChange={(o) => !o && !busy && onClose()}
      footer={
        <>
          <Button variant="secondary" disabled={busy} onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button
            variant="danger"
            loading={busy}
            onClick={async () => {
              setBusy(true);
              await go();
              setBusy(false);
              onClose();
            }}
          >
            {t("rewind.confirm")}
          </Button>
        </>
      }
    />
  );
}

/** The owner's message as a field: Enter sends it again, Escape leaves it as it was. */
export function RewindEditor({
  draft,
  onChange,
  onCancel,
  onSend,
}: {
  draft: string;
  onChange: (text: string) => void;
  onCancel: () => void;
  onSend: () => void;
}) {
  const t = useT();
  return (
    <div className="rewind__edit">
      <Textarea
        autoFocus
        rows={Math.min(10, Math.max(2, draft.split("\n").length))}
        value={draft}
        aria-label={t("rewind.edit")}
        onChange={(e) => onChange(e.currentTarget.value)}
        onKeyDown={(e) => {
          if (e.key === "Escape") onCancel();
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            onSend();
          }
        }}
      />
      <div className="rewind__bar">
        <Button size="sm" variant="secondary" onClick={onCancel}>
          {t("common.cancel")}
        </Button>
        <Button size="sm" disabled={!draft.trim()} onClick={onSend}>
          {t("rewind.send")}
        </Button>
      </div>
    </div>
  );
}
