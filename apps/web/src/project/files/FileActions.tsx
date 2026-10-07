import type { FileEntry } from "@apx/protocol";
import { Button, Dialog, Field, Icons, Input, type MenuEntry } from "@apx/ui";
import { useState } from "react";
import {
  coreOnThisComputer,
  downloadFile,
  type FileWhere,
  keepFile,
  renameFile,
  revealFile,
  trashFile,
} from "../../data/files.ts";
import { notify } from "../../data/notices.ts";
import { type T, useT } from "../../i18n/index.ts";

/** A file or folder the owner acts on, and how the pane learns what changed. */
export type FileTarget = { entry: FileEntry; absolute: string };
export type FileChange = { kind: "renamed"; from: string; to: string } | { kind: "trashed"; path: string };

const copy = async (text: string, t: T) => {
  try {
    await navigator.clipboard.writeText(text);
    notify(t("files.copied"), "info");
  } catch {
    notify(t("files.copyFailed"));
  }
};

/**
 * The right-click menu of a file or folder: download, Finder (only with the core on this computer), keeping a temp
 * file, its paths, rename, trash.
 */
export function fileMenu(
  target: FileTarget,
  o: { where: FileWhere; t: T; onRename(): void; onTrash(): void },
): MenuEntry[] {
  const { t } = o;
  const file = target.entry.kind === "file";
  return [
    ...(file
      ? [
          {
            label: t("files.download"),
            icon: <Icons.Download />,
            onSelect: () => void downloadFile(o.where, target.entry.path),
          },
        ]
      : []),
    ...(coreOnThisComputer()
      ? [
          {
            label: t("files.reveal"),
            icon: <Icons.FolderOpen />,
            onSelect: () => void revealFile(o.where, target.entry.path),
          },
        ]
      : []),
    ...("thread" in o.where && o.where.scratch
      ? [
          {
            label: t("files.keep"),
            icon: <Icons.Pin />,
            onSelect: () => void keepFile((o.where as { thread: string }).thread, target.entry.path),
          },
        ]
      : []),
    { type: "separator" },
    { label: t("files.copyPath"), icon: <Icons.Copy />, onSelect: () => void copy(target.absolute, t) },
    { label: t("files.copyRelative"), icon: <Icons.Copy />, onSelect: () => void copy(target.entry.path, t) },
    { type: "separator" },
    { label: t("files.rename"), icon: <Icons.Pencil />, onSelect: o.onRename },
    { label: t("files.trash"), icon: <Icons.Trash2 />, danger: true, onSelect: o.onTrash },
  ];
}

/** Renames a file or folder in place (a name, never a path). */
export function RenameDialog({
  where,
  entry,
  onDone,
  onClose,
}: {
  where: FileWhere;
  entry: FileEntry;
  onDone(change: FileChange): void;
  onClose(): void;
}) {
  const t = useT();
  const [name, setName] = useState(entry.name);
  const [busy, setBusy] = useState(false);
  const ok = name.trim() && name.trim() !== entry.name && !/[/\\]/.test(name);
  const save = async () => {
    if (!ok) return;
    setBusy(true);
    const to = await renameFile(where, entry.path, name.trim());
    setBusy(false);
    if (to) onDone({ kind: "renamed", from: entry.path, to });
  };
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={t("files.renameTitle")}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button loading={busy} disabled={!ok} onClick={() => void save()}>
            {t("files.rename")}
          </Button>
        </>
      }
    >
      <Field label={t("files.newName")}>
        {(id) => (
          <Input
            id={id}
            autoFocus
            // Like Finder: the name is selected, its extension kept.
            onFocus={(e) => {
              const dot = entry.kind === "file" ? entry.name.lastIndexOf(".") : -1;
              e.currentTarget.setSelectionRange(0, dot > 0 ? dot : entry.name.length);
            }}
            value={name}
            onChange={(e) => setName(e.currentTarget.value)}
            onKeyDown={(e) => e.key === "Enter" && void save()}
          />
        )}
      </Field>
    </Dialog>
  );
}

/** Asks before moving a file or folder to the system trash (it can be recovered from there). */
export function TrashDialog({
  where,
  entry,
  onDone,
  onClose,
}: {
  where: FileWhere;
  entry: FileEntry;
  onDone(change: FileChange): void;
  onClose(): void;
}) {
  const t = useT();
  const [busy, setBusy] = useState(false);
  const go = async () => {
    setBusy(true);
    const ok = await trashFile(where, entry.path);
    setBusy(false);
    if (ok) onDone({ kind: "trashed", path: entry.path });
  };
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={t(entry.kind === "dir" ? "files.trashFolderTitle" : "files.trashTitle", { name: entry.name })}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button variant="danger" loading={busy} leadingIcon={<Icons.Trash2 size={14} />} onClick={() => void go()}>
            {t("files.trash")}
          </Button>
        </>
      }
    >
      <p className="files__confirm">{t("files.trashBody", { path: entry.path })}</p>
    </Dialog>
  );
}
