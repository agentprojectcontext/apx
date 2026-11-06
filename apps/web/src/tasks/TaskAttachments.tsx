import type { Task } from "@apx/protocol";
import { Button, Dialog, FileTile, FileTileGrid, IconButton, Icons, type MediaKind, mediaKindOf } from "@apx/ui";
import { type ReactNode, Suspense, useEffect, useRef, useState } from "react";
import { type Viewable, viewableAs } from "../chat/parts/fileKind.ts";
import { useMediaUrl } from "../chat/parts/useMediaUrl.ts";
import { formatBytes } from "../common/format.ts";
import { client } from "../data/client.ts";
import { type Attached, upload } from "../data/composer.ts";
import { downloadMedia } from "../data/media.ts";
import { useT } from "../i18n/index.ts";
import { FileViewer, MediaGroup } from "../lazy.ts";
import { cleanupTaskUpload, discardTaskUpload } from "./draftAttachments.ts";
import "./attachments.css";

export function TaskAttachments({
  value,
  onChange,
  task,
  onBusy,
  disabled = false,
}: {
  value: Attached[];
  onChange: (value: Attached[]) => void;
  task?: Task;
  onBusy?: (busy: boolean) => void;
  disabled?: boolean;
}) {
  const t = useT();
  const limit = task ? 50 : 20;
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [viewing, setViewing] = useState<{ index: number }>();
  const [reading, setReading] = useState<{ file: Attached; kind: Viewable }>();
  const [removing, setRemoving] = useState<Attached>();
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const working = (next: boolean) => {
    if (!mounted.current) return;
    setBusy(next);
    onBusy?.(next);
  };
  const add = async (files: File[]) => {
    if (busy || disabled || !files.length) return;
    if (value.length + files.length > limit) {
      setError(t("tasks.attachments.limit", { count: limit }));
      return;
    }
    working(true);
    setError("");
    let next = value;
    try {
      for (const file of files) {
        if (!mounted.current) break;
        const media = await upload(file, undefined, { taskAsset: true });
        if (!mounted.current) {
          cleanupTaskUpload(media.id);
          break;
        }
        if (task) {
          try {
            const result = await client.call("tasks.attach", { task: task.id, media_ids: [media.id] });
            next = result.attachments.map((a) => ({ ...a, id: a.media_id }));
          } catch (error) {
            cleanupTaskUpload(media.id);
            throw error;
          }
        } else next = [...next, media];
        if (mounted.current) onChange(next);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      working(false);
    }
  };
  const remove = async (id: string) => {
    if (busy || disabled) return;
    working(true);
    setError("");
    try {
      if (task) await client.call("tasks.detach", { task: task.id, media_id: id });
      else await discardTaskUpload(id);
      onChange(value.filter((a) => a.id !== id));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      working(false);
    }
  };
  const images = value.filter((a) => a.kind === "image");
  const open = (a: Attached) => {
    if (a.kind === "image") return setViewing({ index: images.findIndex((i) => i.id === a.id) });
    const kind = viewableAs(a.mime, a.bytes);
    if (kind) setReading({ file: a, kind });
    else void downloadMedia(a.id, a.name).catch((e) => setError(e instanceof Error ? e.message : String(e)));
  };
  return (
    <section className="taskattachments" aria-label={t("tasks.attachments")} aria-busy={busy}>
      <div className="taskattachments__header">
        <span>{t("tasks.attachments")}</span>
        <Button
          size="sm"
          variant="secondary"
          disabled={busy || disabled || value.length >= limit}
          onClick={() => input.current?.click()}
          leadingIcon={<Icons.Paperclip size={14} />}
        >
          {t(busy ? "tasks.attachments.uploading" : "tasks.attachments.add")}
        </Button>
        <input
          ref={input}
          type="file"
          multiple
          hidden
          aria-label={t("tasks.attachments.add")}
          disabled={busy || disabled}
          onChange={(e) => {
            const files = Array.from(e.currentTarget.files ?? []);
            e.currentTarget.value = "";
            void add(files);
          }}
        />
      </div>
      {error && <p role="alert">{error}</p>}
      {value.length > 0 && (
        <FileTileGrid label={t("tasks.attachments")}>
          {value.map((a) => (
            <AttachmentTile
              key={a.id}
              file={a}
              disabled={busy || disabled}
              onOpen={() => open(a)}
              onRemove={() => setRemoving(a)}
            />
          ))}
        </FileTileGrid>
      )}
      {viewing && viewing.index >= 0 && (
        <Suspense fallback={null}>
          <MediaGroup
            block={{
              kind: "images",
              key: "task-attachments",
              parts: images.map((a) => ({ type: "image", media_id: a.id, alt: a.name })),
            }}
            view={{ start: viewing.index, onClose: () => setViewing(undefined) }}
          />
        </Suspense>
      )}
      {reading && (
        <Suspense fallback={null}>
          <FileViewer
            mediaId={reading.file.id}
            name={reading.file.name}
            kind={reading.kind}
            onClose={() => setReading(undefined)}
          />
        </Suspense>
      )}
      {removing && (
        <RemoveAttachment
          name={removing.name}
          saved={!!task}
          onCancel={() => setRemoving(undefined)}
          onConfirm={async () => {
            await remove(removing.id);
            setRemoving(undefined);
          }}
        />
      )}
    </section>
  );
}

const KIND_ICON: Partial<Record<MediaKind, ReactNode>> = {
  audio: <Icons.Music size={22} />,
  video: <Icons.Film size={22} />,
};

/** One attachment as a square: its picture or its name and size, with download and remove on hover. */
function AttachmentTile({
  file,
  disabled,
  onOpen,
  onRemove,
}: {
  file: Attached;
  disabled: boolean;
  onOpen: () => void;
  onRemove: () => void;
}) {
  const t = useT();
  const picture = file.kind === "image";
  const src = useMediaUrl(picture ? file.id : undefined);
  const [saving, setSaving] = useState(false);
  const download = async () => {
    setSaving(true);
    try {
      await downloadMedia(file.id, file.name);
    } finally {
      setSaving(false);
    }
  };
  return (
    <FileTile
      name={file.name}
      meta={formatBytes(file.bytes)}
      src={src}
      loading={picture && !src ? "image" : undefined}
      icon={KIND_ICON[mediaKindOf(file.mime, file.name)]}
      onOpen={onOpen}
      actions={
        <>
          <IconButton
            size="sm"
            label={t("file.download")}
            icon={<Icons.Download size={14} />}
            disabled={saving}
            onClick={() => void download()}
          />
          <IconButton
            size="sm"
            disabled={disabled}
            label={t("tasks.attachments.remove", { name: file.name })}
            icon={<Icons.X size={14} />}
            onClick={onRemove}
          />
        </>
      }
    />
  );
}

/** Asks before an attachment comes off: on a saved task it is gone for everyone who opens it. */
function RemoveAttachment({
  name,
  saved,
  onCancel,
  onConfirm,
}: {
  name: string;
  saved: boolean;
  onCancel: () => void;
  onConfirm: () => Promise<void>;
}) {
  const t = useT();
  const [busy, setBusy] = useState(false);
  return (
    <Dialog
      open
      size="sm"
      onOpenChange={(o) => !o && !busy && onCancel()}
      title={t("tasks.attachments.removeTitle")}
      description={t(saved ? "tasks.attachments.removeSaved" : "tasks.attachments.removeDraft", { name })}
      closeLabel={t("common.close")}
      footer={
        <>
          <Button variant="secondary" disabled={busy} onClick={onCancel}>
            {t("common.cancel")}
          </Button>
          <Button
            variant="danger"
            loading={busy}
            onClick={async () => {
              setBusy(true);
              try {
                await onConfirm();
              } finally {
                setBusy(false);
              }
            }}
          >
            {t("tasks.attachments.removeConfirm")}
          </Button>
        </>
      }
    />
  );
}
