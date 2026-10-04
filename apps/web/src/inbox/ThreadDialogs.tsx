import type { Thread } from "@apx/protocol";
import { Button, Dialog, Field, Input } from "@apx/ui";
import { useState } from "react";
import { useData } from "../data/state.ts";
import { closeThreadDialog, deleteThread, updateThread, useThreadDialog } from "../data/threadAdmin.ts";
import { useT } from "../i18n/index.ts";
import { go, nav } from "../shell/nav.ts";

/** The rename and delete dialogs a chat's menu opens; mounted once, loaded on first use. */
export function ThreadDialogs() {
  const open = useThreadDialog();
  const thread = useData((s) => (open ? s.threads[open.thread] : undefined));
  if (!open || !thread) return null;
  return open.kind === "rename" ? (
    <RenameDialog key={thread.id} thread={thread} />
  ) : (
    <DeleteDialog key={thread.id} thread={thread} />
  );
}

function RenameDialog({ thread }: { thread: Thread }) {
  const t = useT();
  // A chat with the automatic title starts empty: typing names it, leaving it empty keeps it automatic.
  const [title, setTitle] = useState(thread.auto_title ? thread.title : "");
  const [busy, setBusy] = useState(false);
  const save = async () => {
    if (busy) return;
    setBusy(true);
    const ok = await updateThread(thread.id, { title: title.trim() || null });
    setBusy(false);
    if (ok) closeThreadDialog();
  };
  return (
    <Dialog
      open
      size="sm"
      onOpenChange={(o) => !o && closeThreadDialog()}
      title={t("thread.rename.title")}
      closeLabel={t("common.close")}
      footer={
        <>
          <Button variant="secondary" onClick={closeThreadDialog}>
            {t("common.cancel")}
          </Button>
          <Button loading={busy} onClick={() => void save()}>
            {t("common.save")}
          </Button>
        </>
      }
    >
      <Field label={t("thread.rename.label")} hint={t("thread.rename.hint")}>
        {(id) => (
          <Input
            id={id}
            autoFocus
            maxLength={200}
            placeholder={thread.auto_title ?? thread.title}
            value={title}
            onChange={(e) => setTitle(e.currentTarget.value)}
            onKeyDown={(e) => e.key === "Enter" && void save()}
          />
        )}
      </Field>
    </Dialog>
  );
}

function DeleteDialog({ thread }: { thread: Thread }) {
  const t = useT();
  const [busy, setBusy] = useState(false);
  const remove = async () => {
    if (busy) return;
    setBusy(true);
    const ok = await deleteThread(thread.id);
    setBusy(false);
    if (!ok) return;
    closeThreadDialog();
    if (nav.get().threadId === thread.id) go.thread("home");
  };
  return (
    <Dialog
      open
      size="sm"
      onOpenChange={(o) => !o && closeThreadDialog()}
      title={t("thread.delete.title")}
      description={t("thread.delete.body")}
      closeLabel={t("common.close")}
      footer={
        <>
          <Button variant="secondary" onClick={closeThreadDialog}>
            {t("common.cancel")}
          </Button>
          <Button variant="danger" loading={busy} onClick={() => void remove()}>
            {t("thread.delete.confirm")}
          </Button>
        </>
      }
    >
      {t("thread.delete.what", { title: thread.title })}
    </Dialog>
  );
}
