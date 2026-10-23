import type { Part } from "@apx/protocol";
import { Icons } from "@apx/ui";
import { lazy, Suspense, useState } from "react";
import { formatBytes } from "../../common/format.ts";
import { audioEnded } from "../../data/audioEnd.ts";
import { mediaUrl } from "../../data/media.ts";
import { useT } from "../../i18n/index.ts";
import { docRef } from "../../panel/documents.ts";
import { go, useNav } from "../../shell/nav.ts";
import { useMediaUrl } from "./useMediaUrl.ts";

// Its buttons come after the file shows: not part of the first load.
const DocumentActions = lazy(() =>
  import("../../panel/DocumentActions.tsx").then((m) => ({ default: m.DocumentActions })),
);

/** An attachment from either participant, with inline audio playback and a named download (videos have their own carousel). */
export function FilePart({ part }: { part: Extract<Part, { type: "file" }> }) {
  const t = useT();
  const thread = useNav((s) => s.threadId);
  const [busy, setBusy] = useState(false);
  const audio = part.mime.startsWith("audio/");
  const src = useMediaUrl(audio ? part.media_id : undefined);
  const open = async () => {
    setBusy(true);
    try {
      const url = await mediaUrl(part.media_id);
      const a = document.createElement("a");
      a.href = url;
      a.download = part.name;
      a.click();
    } finally {
      setBusy(false);
    }
  };
  if (part.document)
    return (
      <div className="documentpart__wrap">
        <button type="button" className="filepart documentpart" onClick={() => go.document(part.media_id)}>
          <Icons.FileText size={18} />
          <span className="documentpart__info">
            <span className="documentpart__label">{t("document.label")}</span>
            <span className="filepart__name">{part.document.title}</span>
            <span className="documentpart__name">{part.document.source?.path ?? part.name}</span>
          </span>
          <span className="filepart__size">{formatBytes(part.bytes)}</span>
          <Icons.ArrowRight size={14} />
        </button>
        <div className="documentpart__actions">
          <Suspense fallback={null}>
            <DocumentActions doc={docRef({ ...part, document: part.document })} thread={thread} />
          </Suspense>
        </div>
      </div>
    );
  return (
    <div>
      {audio && src && (
        // biome-ignore lint/a11y/useMediaCaption: audio files are shared as supplied, without a separate caption track.
        <audio src={src} controls preload="metadata" aria-label={part.name} onEnded={audioEnded} />
      )}
      <button type="button" className="filepart" onClick={() => void open()} disabled={busy} title={part.name}>
        <Icons.FileText size={14} />
        <span className="filepart__name">{part.name}</span>
        <span className="filepart__size">{formatBytes(part.bytes)}</span>
      </button>
    </div>
  );
}
