import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { Camera, FileText, Image as ImageIcon, Mic, Paperclip, Plus, Send, Trash2, X } from "lucide-react";
import { ChatInput, type FilePicker } from "../ui/chat-input";
import { ModelPicker } from "./ModelPicker";
import { Spinner } from "../ui";
import { Button } from "../ui/button";
import { Tip } from "../ui/tip";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "../ui/dropdown-menu";
import { ATTACH_ACCEPT, attachmentRejection, uploadMedia, type UploadedMedia } from "../../lib/api/media";
import { transcribeAudio } from "../../lib/api/transcribe";
import { canRecord, useRecorder } from "../../hooks/useRecorder";
import { cn } from "../../lib/cn";
import { t } from "../../i18n";

interface Props {
  /** `media` are the files this turn carries, already stored by the daemon. */
  onSend: (text: string, media?: UploadedMedia[]) => void | Promise<void>;
  onStop: () => void;
  streaming: boolean;
  /** Selected model override ("" = Auto). Omit to hide the picker. */
  model?: string;
  onModelChange?: (m: string) => void;
  /** Whether this conversation can carry files. Both the super-agent and a
   *  project agent do: each turn is resolved against ~/.apx/media on the daemon,
   *  images ride on the user message for a multimodal engine, and a marker names
   *  the file in the prompt so an engine without vision still knows it arrived. */
  allowFiles?: boolean;
  /** Welded into the top edge of the field: the conversation's context strip.
   *  It used to sit on its own line above, separated by a border, which on a
   *  phone reads as two floating things instead of one. */
  context?: ReactNode;
  /** The composer hovers OVER the thread rather than sitting in the column
   *  under it: the bar loses its opaque backing and the conversation runs
   *  behind, staying legible right up to the card's edge. */
  floating?: boolean;
}

/** A file the user handed over: on screen immediately, uploading behind it. */
interface Pending {
  id: string;
  file: File;
  /** Object URL for an image, so the thumbnail is instant and local. */
  preview: string | null;
  media?: UploadedMedia;
  error?: string;
  /** Set on a recording, so its chip reads as a voice note and not as a file. */
  seconds?: number;
}

/** What the "photo or video" entry offers, vs "file" which offers everything. */
const VISUAL_ACCEPT = ".jpg,.jpeg,.png,.gif,.webp,.heic,.mp4,.mov,.webm";

// Telegram's own ceiling for one album, and a sane one here too: past this the
// turn is a folder, and a folder belongs on disk with a path in the message.
const MAX_ATTACHMENTS = 10;

let seq = 0;
const nextId = () => `att-${++seq}`;

export function Composer({ onSend, onStop, streaming, model, onModelChange, allowFiles, context, floating }: Props) {
  const [text, setText] = useState("");
  const [pending, setPending] = useState<Pending[]>([]);
  const [transcribing, setTranscribing] = useState(false);
  const pickerRef = useRef<FilePicker>(null);
  const cameraRef = useRef<HTMLInputElement>(null);
  const rec = useRecorder();

  // In-flight uploads by id, so Enter pressed mid-upload waits for the files
  // instead of sending the caption without them.
  const uploads = useRef(new Map<string, Promise<UploadedMedia>>());
  // Every object URL handed out, revoked when it is dropped or on unmount.
  const previews = useRef(new Set<string>());
  // How many are queued, readable synchronously — `attach` needs the count
  // before the state it would have read has been applied.
  const countRef = useRef(0);
  // And the list itself, for the same reason: `remove` and `dropAll` need to
  // revoke object URLs, which is a side effect and so cannot live in an
  // updater that reads them.
  const pendingRef = useRef<Pending[]>([]);
  useEffect(() => {
    countRef.current = pending.length;
    pendingRef.current = pending;
  }, [pending]);

  const forget = useCallback((url: string | null) => {
    if (!url) return;
    previews.current.delete(url);
    URL.revokeObjectURL(url);
  }, []);

  useEffect(() => {
    const urls = previews.current;
    return () => {
      for (const u of urls) URL.revokeObjectURL(u);
      urls.clear();
    };
  }, []);

  const remove = (id: string) => {
    // Revoking outside the updater for the same reason `attach` starts its
    // uploads outside one: an updater that is called twice must not do it
    // twice, and revoking a URL a second time would break the thumbnail that
    // is still on screen.
    const gone = pendingRef.current.find((p) => p.id === id);
    if (gone) forget(gone.preview);
    uploads.current.delete(id);
    countRef.current = Math.max(0, countRef.current - 1);
    setPending((curr) => curr.filter((p) => p.id !== id));
  };

  const dropAll = () => {
    for (const p of pendingRef.current) forget(p.preview);
    uploads.current.clear();
    countRef.current = 0;
    setPending([]);
  };

  /** Take files: on screen at once, uploading behind them, one entry each.
   *
   *  The uploads are started HERE and the state updater below stays pure. A
   *  state updater must be free of side effects — React is allowed to call it
   *  more than once for a single update, and in StrictMode it always does, so
   *  starting an upload inside it uploaded every file twice and left an orphan
   *  copy in ~/.apx/media for each one. `countRef` is what the room check reads
   *  instead of `curr.length`, kept in step with the list below. */
  const attach = useCallback((files: File[], extra?: { seconds?: number }) => {
    if (!files.length) return;
    const room = MAX_ATTACHMENTS - countRef.current;
    if (room <= 0) return;
    const added: Pending[] = [];
    for (const file of files.slice(0, room)) {
      const id = nextId();
      const rejected = attachmentRejection(file);
      const preview = file.type.startsWith("image/") ? URL.createObjectURL(file) : null;
      if (preview) previews.current.add(preview);
      added.push({ id, file, preview, ...(rejected ? { error: rejected } : {}), ...extra });
      if (rejected) continue;
      const job = uploadMedia(file);
      uploads.current.set(id, job);
      job
        .then((media) => setPending((c) => c.map((p) => (p.id === id ? { ...p, media } : p))))
        .catch((e: Error) =>
          setPending((c) =>
            c.map((p) => (p.id === id ? { ...p, error: e?.message || t("chat_ui.attach_failed") } : p)),
          ),
        );
    }
    if (!added.length) return;
    countRef.current += added.length;
    setPending((curr) => [...curr, ...added]);
  }, []);

  // ── Voice notes ────────────────────────────────────────────────────────────
  // Stop → the recording becomes an attachment immediately (it is what you
  // sent), and its transcript is dropped into the field so the turn carries
  // words a model can actually read. Editable before sending, like any draft.
  const finishRecording = async () => {
    const out = await rec.stop();
    if (!out) return;
    attach([out.file], { seconds: out.seconds });
    setTranscribing(true);
    try {
      const said = await transcribeAudio(out.file);
      if (said) setText((curr) => (curr ? `${curr} ${said}` : said));
    } catch {
      /* no STT configured, or it failed: the audio still goes, silently */
    } finally {
      setTranscribing(false);
    }
  };

  const submit = async () => {
    const body = text.trim();
    const usable = pending.filter((p) => !p.error);
    // Anything still uploading is waited on here rather than dropped.
    const media: UploadedMedia[] = [];
    for (const p of usable) {
      if (p.media) {
        media.push(p.media);
        continue;
      }
      const job = uploads.current.get(p.id);
      if (!job) continue;
      try {
        media.push(await job);
      } catch {
        return; // the chip already says why
      }
    }
    if (!body && !media.length) return;
    setText("");
    dropAll();
    await onSend(body, media.length ? media : undefined);
  };

  const uploading = pending.some((p) => !p.media && !p.error);
  const ready = pending.some((p) => p.media);
  const full = pending.length >= MAX_ATTACHMENTS;

  return (
    // The bottom padding clears the phone's home indicator; it resolves to the
    // normal p-3 anywhere with no inset, so the desktop layout is untouched.
    <div
      className={cn(
        "relative shrink-0 p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]",
        floating ? "pt-5" : "border-t border-border bg-card/60",
      )}
    >
      {/* Floating: the thread runs UNDER the field, and the band above the card
          stays plain glass. A backdrop filter there looked right over the
          message text and wrong over everything else living in that strip — it
          smeared the scrollbar into a grey smudge. The conversation simply
          stays legible until it slides under the opaque card. */}
      {allowFiles && (
        // Its own input: `capture` is what turns a picker into the camera, and
        // it cannot be toggled on the shared one without also changing what the
        // gallery entry opens.
        <input
          ref={cameraRef}
          type="file"
          accept="image/*"
          capture="environment"
          className="hidden"
          onChange={(e) => {
            attach(Array.from(e.target.files || []));
            e.target.value = "";
          }}
        />
      )}
      {rec.recording ? (
        <RecordingBar rec={rec} onSend={finishRecording} />
      ) : (
        <ChatInput
          className="relative"
          header={context}
          value={text}
          onValueChange={setText}
          onSubmit={submit}
          onStop={onStop}
          busy={streaming}
          placeholder={t("project.chat.placeholder")}
          maxRows={14}
          onFiles={allowFiles ? (files) => attach(files) : undefined}
          accept={ATTACH_ACCEPT}
          pickerRef={pickerRef}
          // An attachment on its own is a turn — the daemon writes the marker
          // that stands in for the words. Not while it is still uploading.
          allowEmpty={ready && !uploading}
          above={
            pending.length || transcribing || rec.error ? (
              <Gallery
                pending={pending}
                transcribing={transcribing}
                error={rec.error}
                onRemove={remove}
              />
            ) : undefined
          }
          leading={
            allowFiles ? (
              // Not gated on `streaming`. A turn written during a run is a turn
              // like any other, and "look at this" with no way to attach the
              // this is half a composer. Only a full tray stops it.
              <AttachMenu
                disabled={full}
                onPhoto={() => pickerRef.current?.open(VISUAL_ACCEPT)}
                onFile={() => pickerRef.current?.open(ATTACH_ACCEPT)}
                onCamera={() => cameraRef.current?.click()}
              />
            ) : undefined
          }
          trailing={
            allowFiles && canRecord() ? (
              <Tip content={t("chat_ui.record")}>
                <Button
                  type="button"
                  size="icon-sm"
                  variant="ghost"
                  disabled={full} // see the attach menu: composing is not gated on the run
                  onClick={() => void rec.start()}
                  aria-label={t("chat_ui.record")}
                >
                  <Mic className="size-4" />
                </Button>
              </Tip>
            ) : undefined
          }
          footer={
            onModelChange ? (
              <ModelPicker value={model || ""} onChange={onModelChange} disabled={streaming} />
            ) : undefined
          }
        />
      )}
    </div>
  );
}

/** The "+" that knows the three ways in. One tap, three named destinations —
 *  a bare picker makes you guess whether a video counts as a photo. */
function AttachMenu({
  disabled,
  onPhoto,
  onFile,
  onCamera,
}: {
  disabled?: boolean;
  onPhoto: () => void;
  onFile: () => void;
  onCamera: () => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        disabled={disabled}
        aria-label={t("chat_ui.attach")}
        className="inline-flex size-7 shrink-0 items-center justify-center rounded-[min(var(--radius-md),12px)] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-40 data-[popup-open]:bg-muted data-[popup-open]:text-foreground"
      >
        <Plus className="size-4" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" side="top" sideOffset={8} className="w-48">
        <DropdownMenuItem onClick={onPhoto}>
          <ImageIcon className="size-4" /> {t("chat_ui.attach_photo")}
        </DropdownMenuItem>
        <DropdownMenuItem onClick={onFile}>
          <Paperclip className="size-4" /> {t("chat_ui.attach_file")}
        </DropdownMenuItem>
        <DropdownMenuItem onClick={onCamera}>
          <Camera className="size-4" /> {t("chat_ui.attach_camera")}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** What is about to be sent: images as a strip of thumbnails, everything else
 *  as a row you can read the name of. */
function Gallery({
  pending,
  transcribing,
  error,
  onRemove,
}: {
  pending: Pending[];
  transcribing: boolean;
  error: string | null;
  onRemove: (id: string) => void;
}) {
  const shots = pending.filter((p) => p.preview);
  const files = pending.filter((p) => !p.preview);
  return (
    <div className="flex flex-col gap-1.5">
      {error && <span className="px-1 text-xs text-destructive">{error}</span>}
      {shots.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {shots.map((p) => (
            <div key={p.id} className="relative size-16 overflow-hidden rounded-xl bg-muted">
              <img src={p.preview!} alt="" className="size-full object-cover" />
              {!p.media && !p.error && (
                <span className="absolute inset-0 grid place-items-center bg-background/50">
                  <Spinner size={14} />
                </span>
              )}
              {p.error && (
                <span className="absolute inset-0 grid place-items-center bg-destructive/70 p-1 text-center text-[9px] leading-tight text-white">
                  {p.error}
                </span>
              )}
              <button
                type="button"
                onClick={() => onRemove(p.id)}
                aria-label={t("chat_ui.attach_remove")}
                className="absolute right-0.5 top-0.5 grid size-5 place-items-center rounded-full bg-background/80 text-muted-foreground hover:text-foreground"
              >
                <X size={11} />
              </button>
            </div>
          ))}
        </div>
      )}
      {files.map((p) => (
        <FileChip key={p.id} pending={p} onRemove={() => onRemove(p.id)} />
      ))}
      {transcribing && (
        <span className="flex items-center gap-1.5 px-1 text-xs text-muted-foreground">
          <Spinner size={12} /> {t("chat_ui.transcribing")}
        </span>
      )}
    </div>
  );
}

function FileChip({ pending, onRemove }: { pending: Pending; onRemove: () => void }) {
  const voice = typeof pending.seconds === "number";
  return (
    <div className="flex items-center gap-2 rounded-xl bg-muted/70 p-1.5 pr-2 text-xs">
      <span
        className={cn(
          "grid size-10 shrink-0 place-items-center rounded-lg bg-background",
          voice ? "text-primary" : "text-muted-foreground",
        )}
      >
        {voice ? <Mic size={14} /> : <FileText size={14} />}
      </span>
      <span className="min-w-0 flex-1 truncate">
        {voice ? `${t("chat_ui.voice_note")} · ${clock(pending.seconds!)}` : pending.file.name || t("chat_ui.attachment")}
      </span>
      {!pending.media && !pending.error && <Spinner size={12} />}
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

/** The composer while the mic is open: bin on the left, what it is hearing in
 *  the middle, send on the right. Nothing else is reachable, on purpose. */
function RecordingBar({
  rec,
  onSend,
}: {
  rec: ReturnType<typeof useRecorder>;
  onSend: () => void;
}) {
  return (
    <div className="flex items-center gap-2 rounded-2xl border border-border bg-card p-2 shadow-sm">
      <Tip content={t("chat_ui.rec_cancel")}>
        <Button
          type="button"
          size="icon-sm"
          variant="ghost"
          onClick={rec.cancel}
          aria-label={t("chat_ui.rec_cancel")}
        >
          <Trash2 className="size-4" />
        </Button>
      </Tip>
      <span className="flex size-2 shrink-0 animate-pulse rounded-full bg-destructive" />
      <span className="w-10 shrink-0 font-mono text-xs tabular-nums text-muted-foreground">
        {clock(rec.seconds)}
      </span>
      <div className="flex h-6 min-w-0 flex-1 items-center gap-[2px] overflow-hidden">
        {rec.levels.map((v, i) => (
          <span
            key={i}
            className="w-[3px] shrink-0 rounded-full bg-primary/70"
            style={{ height: `${Math.max(10, v * 100)}%` }}
          />
        ))}
      </div>
      <Tip content={t("chat_ui.send")}>
        <Button type="button" size="icon-sm" variant="default" onClick={onSend} aria-label={t("chat_ui.send")}>
          <Send className="size-4" />
        </Button>
      </Tip>
    </div>
  );
}

function clock(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}
