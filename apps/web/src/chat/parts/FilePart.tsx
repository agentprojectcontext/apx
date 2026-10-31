import type { Part } from "@apx/protocol";
import { IconButton, Icons, MediaLoader, mediaKindOf } from "@apx/ui";
import { Suspense, useState } from "react";
import { formatBytes } from "../../common/format.ts";
import { audioEnded } from "../../data/audioEnd.ts";
import { mediaUrl } from "../../data/media.ts";
import { useT } from "../../i18n/index.ts";
import { DocumentActions, FileViewer } from "../../lazy.ts";
import { docRef } from "../../panel/documents.ts";
import { go, useNav } from "../../shell/nav.ts";
import { viewableAs } from "./fileKind.ts";
import { useMediaUrl } from "./useMediaUrl.ts";

/**
 * An attachment from either participant, as a chip with its name and size, a download and, for what APX can show (a
 * PDF, text), an open button; audio also plays inline. Pictures and videos have their own grid and carousel.
 */
export function FilePart({ part }: { part: Extract<Part, { type: "file" }> }) {
  const t = useT();
  const thread = useNav((s) => s.threadId);
  const [busy, setBusy] = useState(false);
  const [viewing, setViewing] = useState(false);
  const viewable = viewableAs(part.mime, part.bytes);
  const audio = part.mime.startsWith("audio/");
  const src = useMediaUrl(audio ? part.media_id : undefined);
  const download = async () => {
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
      <div className="filechip" title={part.name}>
        <span className="filechip__icon">
          {busy ? <MediaLoader inline kind={mediaKindOf(part.mime, part.name)} /> : <Icons.FileText size={16} />}
        </span>
        <span className="filechip__info">
          <span className="filechip__name">{part.name}</span>
          <span className="filechip__size">{formatBytes(part.bytes)}</span>
        </span>
        <IconButton
          size="sm"
          label={t("file.download")}
          icon={<Icons.Download size={14} />}
          onClick={() => void download()}
          disabled={busy}
        />
        {viewable && (
          <IconButton
            size="sm"
            label={t("file.open")}
            icon={<Icons.ExternalLink size={14} />}
            onClick={() => setViewing(true)}
          />
        )}
      </div>
      {viewing && viewable && (
        <Suspense fallback={null}>
          <FileViewer mediaId={part.media_id} name={part.name} kind={viewable} onClose={() => setViewing(false)} />
        </Suspense>
      )}
    </div>
  );
}
