import { useEffect, useRef, useState } from "react";
import { FileText, X } from "lucide-react";
import { ChatInput } from "../ui/chat-input";
import { ModelPicker } from "./ModelPicker";
import { Spinner } from "../ui";
import { ATTACH_ACCEPT, attachmentRejection, uploadMedia, type UploadedMedia } from "../../lib/api/media";
import { t } from "../../i18n";

interface Props {
  /** `media` is the file this turn carries, already stored by the daemon. */
  onSend: (text: string, media?: UploadedMedia) => void | Promise<void>;
  onStop: () => void;
  streaming: boolean;
  /** Selected model override ("" = Auto). Omit to hide the picker. */
  model?: string;
  onModelChange?: (m: string) => void;
  /** Whether this conversation can carry files. Only the super-agent turn does:
   *  a project agent talks to the engine directly, with no vision and no file
   *  tools, so an attachment there would upload and then be ignored. */
  allowFiles?: boolean;
}

/** A file the user handed over: on screen immediately, uploading behind it. */
interface Pending {
  file: File;
  /** Object URL for an image, so the thumbnail is instant and local. */
  preview: string | null;
  media?: UploadedMedia;
  error?: string;
}

export function Composer({ onSend, onStop, streaming, model, onModelChange, allowFiles }: Props) {
  const [text, setText] = useState("");
  const [pending, setPending] = useState<Pending | null>(null);
  // The in-flight upload, so Enter pressed mid-upload waits for the file
  // instead of sending the caption without it.
  const uploadRef = useRef<Promise<UploadedMedia> | null>(null);

  // Revoke the last preview when it is replaced or the composer goes away.
  const previewRef = useRef<string | null>(null);
  useEffect(() => {
    previewRef.current = pending?.preview || null;
  }, [pending]);
  useEffect(() => () => {
    if (previewRef.current) URL.revokeObjectURL(previewRef.current);
  }, []);

  const dropPending = () => {
    if (pending?.preview) URL.revokeObjectURL(pending.preview);
    uploadRef.current = null;
    setPending(null);
  };

  // One file per turn, as on every other channel: a second pick replaces the
  // first rather than silently queueing behind it.
  const attach = (files: File[]) => {
    const file = files[0];
    if (!file) return;
    if (pending?.preview) URL.revokeObjectURL(pending.preview);

    const rejected = attachmentRejection(file);
    const preview = file.type.startsWith("image/") ? URL.createObjectURL(file) : null;
    if (rejected) {
      uploadRef.current = null;
      setPending({ file, preview, error: rejected });
      return;
    }
    setPending({ file, preview });
    const job = uploadMedia(file);
    uploadRef.current = job;
    job
      .then((media) => setPending((c) => (c?.file === file ? { ...c, media } : c)))
      .catch((e: Error) =>
        setPending((c) => (c?.file === file ? { ...c, error: e?.message || t("chat_ui.attach_failed") } : c)),
      );
  };

  const submit = async () => {
    const body = text.trim();
    let media = pending?.media;
    if (pending && !media) {
      if (pending.error) return; // the chip already says why; nothing to send
      try {
        media = await uploadRef.current!;
      } catch {
        return; // the catch above put the reason on the chip
      }
    }
    if (!body && !media) return;
    setText("");
    dropPending();
    await onSend(body, media);
  };

  const uploading = !!pending && !pending.media && !pending.error;

  return (
    <div className="border-t border-border bg-card/60 p-3">
      <ChatInput
        value={text}
        onValueChange={setText}
        onSubmit={submit}
        onStop={onStop}
        busy={streaming}
        placeholder={t("project.chat.placeholder")}
        maxRows={12}
        onFiles={allowFiles ? attach : undefined}
        accept={ATTACH_ACCEPT}
        // An attachment on its own is a turn — the daemon writes the marker
        // that stands in for the words. Not while it is still uploading.
        allowEmpty={!!pending?.media}
        above={pending ? <PendingChip pending={pending} uploading={uploading} onRemove={dropPending} /> : undefined}
        footer={
          onModelChange ? (
            <ModelPicker value={model || ""} onChange={onModelChange} disabled={streaming} />
          ) : undefined
        }
      />
    </div>
  );
}

function PendingChip({
  pending,
  uploading,
  onRemove,
}: {
  pending: Pending;
  uploading: boolean;
  onRemove: () => void;
}) {
  return (
    <div className="flex items-center gap-2 rounded-xl bg-muted/70 p-1.5 pr-2 text-xs">
      {pending.preview ? (
        <img src={pending.preview} alt="" className="size-10 shrink-0 rounded-lg object-cover" />
      ) : (
        <span className="grid size-10 shrink-0 place-items-center rounded-lg bg-background text-muted-foreground">
          <FileText size={14} />
        </span>
      )}
      <span className="min-w-0 flex-1 truncate">{pending.file.name || t("chat_ui.attachment")}</span>
      {uploading && <Spinner size={12} />}
      {pending.error && <span className="shrink-0 text-destructive">{pending.error}</span>}
      <button
        type="button"
        onClick={onRemove}
        aria-label={t("chat_ui.attach_remove")}
        title={t("chat_ui.attach_remove")}
        className="shrink-0 rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
      >
        <X size={12} />
      </button>
    </div>
  );
}
