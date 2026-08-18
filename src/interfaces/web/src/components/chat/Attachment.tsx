import { useEffect, useState } from "react";
import { Download, FileText, Image as ImageIcon, Mic, Video } from "lucide-react";
import { fetchMediaUrl } from "../../lib/api/media";
import type { MessageMedia } from "../../types/daemon";
import { cn } from "../../lib/cn";
import { t } from "../../i18n";

// What the user actually sent, shown as itself: the voice note plays, the photo
// is the photo, the document opens. The stored turn only holds the marker the
// agent was handed ("[document received: … saved to /Users/…]"), which is
// machine-facing text — the person who sent the file gets the file back.

/** Drop the leading `[…]` marker a media turn carries, leaving the caption
 *  (or, for a voice note, the transcript). Only ever applied to turns that
 *  DO have an attachment, so a plain message starting with a bracket is safe. */
export function stripMediaMarker(text: string): string {
  return text.replace(/^\[[^\]]*\]\s*/, "").trim();
}

function humanSize(bytes: number | null): string {
  if (!bytes || bytes <= 0) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function humanDuration(seconds: number | null): string {
  if (!seconds || seconds <= 0) return "";
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

/** Blob URL for the attachment, fetched with the bearer and revoked on unmount. */
function useMediaUrl(path: string | null) {
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (!path) return;
    let alive = true;
    let objectUrl: string | null = null;
    setFailed(false);
    fetchMediaUrl(path)
      .then((u) => {
        if (!alive) return URL.revokeObjectURL(u);
        objectUrl = u;
        setUrl(u);
      })
      .catch(() => alive && setFailed(true));
    return () => {
      alive = false;
      setUrl(null);
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [path]);
  return { url, failed };
}

const KIND_ICON = {
  audio: Mic,
  photo: ImageIcon,
  video: Video,
  animation: Video,
  document: FileText,
  file: FileText,
} as const;

export function Attachment({ media }: { media: MessageMedia }) {
  const { url, failed } = useMediaUrl(media.path);
  const Icon = KIND_ICON[media.kind] || FileText;
  const label = media.name || t("chat_ui.attachment");
  const detail = [humanDuration(media.duration), humanSize(media.size)].filter(Boolean).join(" · ");

  // The download failed when the file arrived (over Telegram's 20 MB bot
  // limit, usually). The turn still records what was sent — say so rather
  // than offering a player with nothing behind it.
  if (!media.path) {
    return (
      <Card muted>
        <Icon size={14} className="shrink-0" />
        <span className="truncate">{label}</span>
        <span className="shrink-0 text-muted-foreground">· {t("chat_ui.attachment_missing")}</span>
      </Card>
    );
  }

  if (failed) {
    return (
      <Card muted>
        <Icon size={14} className="shrink-0" />
        <span className="truncate">{label}</span>
        <span className="shrink-0 text-muted-foreground">· {t("chat_ui.attachment_failed")}</span>
      </Card>
    );
  }

  if (media.kind === "photo") {
    return url ? (
      <a href={url} target="_blank" rel="noreferrer" className="block max-w-[16rem]">
        <img
          src={url}
          alt={label}
          className="max-h-72 w-full rounded-2xl border border-border object-cover"
        />
      </a>
    ) : (
      <Skeleton className="h-40 w-64" />
    );
  }

  if (media.kind === "video" || media.kind === "animation") {
    return url ? (
      <video src={url} controls className="max-h-72 w-64 rounded-2xl border border-border" />
    ) : (
      <Skeleton className="h-40 w-64" />
    );
  }

  if (media.kind === "audio") {
    return url ? (
      <div className="flex w-64 flex-col gap-1 rounded-2xl border border-border bg-card px-3 py-2 shadow-xs">
        <span className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
          <Mic size={10} /> {t("chat_ui.voice_note")}
          {detail && <span>· {detail}</span>}
        </span>
        {/* Opus in .oga: every Chromium/Firefox build plays it; the download
            link is the way out anywhere that does not. */}
        <audio src={url} controls className="w-full" />
      </div>
    ) : (
      <Skeleton className="h-14 w-64" />
    );
  }

  return (
    <Card>
      <Icon size={14} className="shrink-0 text-muted-foreground" />
      <span className="truncate font-medium">{label}</span>
      {detail && <span className="shrink-0 text-muted-foreground">· {detail}</span>}
      {url && (
        <a
          href={url}
          download={media.name || undefined}
          className="ml-1 shrink-0 text-muted-foreground hover:text-foreground"
          aria-label={t("chat_ui.attachment_open")}
          title={t("chat_ui.attachment_open")}
        >
          <Download size={14} />
        </a>
      )}
    </Card>
  );
}

function Card({ children, muted }: { children: React.ReactNode; muted?: boolean }) {
  return (
    <div
      className={cn(
        "flex max-w-full items-center gap-1.5 rounded-2xl border border-border bg-card px-3 py-2 text-xs shadow-xs",
        muted && "text-muted-foreground",
      )}
    >
      {children}
    </div>
  );
}

function Skeleton({ className }: { className?: string }) {
  return <div className={cn("animate-pulse rounded-2xl bg-muted", className)} />;
}
