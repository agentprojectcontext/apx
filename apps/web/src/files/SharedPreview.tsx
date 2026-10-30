import type { SharedFile } from "@apx/protocol";
import { Button, EmptyState, IconButton, Icons, MediaLoader, mediaKindOf, ProjectTile } from "@apx/ui";
import { useEffect, useState } from "react";
import { formatBytes } from "../common/format.ts";
import { DEFAULT_PID, projectInitial, projectName, projectTone } from "../data/identity.ts";
import { mediaUrl } from "../data/media.ts";
import { useData } from "../data/state.ts";
import { useT } from "../i18n/index.ts";
import { kindIcon, ONE, Sender, SharedActions, when } from "./sharedFile.tsx";

/** What a document shows as text, at most. */
const TEXT_LIMIT = 256 * 1024;
const isText = (f: SharedFile) => /^text\/|json|markdown|xml|yaml/.test(f.mime);

/** The file itself: a picture, a player, a PDF or its text; anything else says it cannot be shown here. */
function Body({ file }: { file: SharedFile }) {
  const t = useT();
  const [url, setUrl] = useState<string>();
  const [text, setText] = useState<string>();
  const [error, setError] = useState(false);
  const pdf = file.mime === "application/pdf";
  const showable = file.kind !== "document" || pdf || isText(file);
  useEffect(() => {
    if (!showable) return;
    let live = true;
    setUrl(undefined);
    setText(undefined);
    setError(false);
    mediaUrl(file.media_id)
      .then(async (u) => {
        if (file.kind === "document" && !pdf) {
          const body = await (await fetch(u)).text();
          if (live) setText(body.slice(0, TEXT_LIMIT));
        } else if (live) setUrl(u);
      })
      .catch(() => live && setError(true));
    return () => {
      live = false;
    };
  }, [file.media_id, file.kind, pdf, showable]);

  if (!showable || error)
    return (
      <EmptyState icon={kindIcon(file.kind, 28)} title={t("files.noPreview")} size="lg">
        {t("shared.noPreviewText")}
      </EmptyState>
    );
  if (!url && text === undefined)
    return (
      <div className="sharedf__loading">
        <MediaLoader kind={mediaKindOf(file.mime, file.name)} />
      </div>
    );
  return (
    <div className={`sharedf__stage is-${pdf ? "pdf" : file.kind}`}>
      {file.kind === "image" && url && <img src={url} alt={file.name} />}
      {file.kind === "video" && url && (
        // biome-ignore lint/a11y/useMediaCaption: files shared in chats carry no captions.
        <video src={url} controls autoPlay aria-label={file.name} />
      )}
      {file.kind === "audio" && url && (
        <span className="sharedf__audio">
          {kindIcon("audio", 40)}
          {/* biome-ignore lint/a11y/useMediaCaption: files shared in chats carry no captions. */}
          <audio src={url} controls autoPlay aria-label={file.name} />
        </span>
      )}
      {pdf && url && <iframe src={url} title={file.name} />}
      {text !== undefined && <pre>{text}</pre>}
    </div>
  );
}

/** One file, shown live over the list, with its actions; back (or Esc) returns to the list where it was. */
export function SharedPreview({
  file,
  onBack,
  onStep,
}: {
  file: SharedFile;
  onBack: () => void;
  /** The previous (-1) or next (1) file of the list, when there is one. */
  onStep: ((by: -1 | 1) => void) | undefined;
}) {
  const t = useT();
  const projects = useData((s) => s.projects);
  const project = projectName(projects, file.project_id);
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLElement && e.target.closest("input, textarea, video, audio")) return;
      if (e.key === "Escape") onBack();
      else if (e.key === "ArrowLeft") onStep?.(-1);
      else if (e.key === "ArrowRight") onStep?.(1);
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [onBack, onStep]);
  return (
    <section className="sharedf__preview" aria-label={file.name || t(ONE[file.kind])}>
      <header className="sharedf__previewhead">
        <Button variant="ghost" size="sm" leadingIcon={<Icons.ArrowLeft size={14} />} onClick={onBack}>
          {t("shared.back")}
        </Button>
        <span className="resv__spacer" />
        {onStep && (
          <span className="sharedf__steps">
            <IconButton label={t("shared.prev")} icon={<Icons.ChevronLeft size={16} />} onClick={() => onStep(-1)} />
            <IconButton label={t("shared.next")} icon={<Icons.ChevronRight size={16} />} onClick={() => onStep(1)} />
          </span>
        )}
      </header>
      <div className="sharedf__previewinfo">
        <div className="sharedf__previewtitle">
          <h2>{file.name || t(ONE[file.kind])}</h2>
          <span className="sharedf__meta">
            <span className="sharedf__project">
              <ProjectTile
                tone={projectTone(file.project_id ?? DEFAULT_PID)}
                initial={projectInitial(project)}
                size={14}
              />
              {project}
            </span>
            <span className="sharedf__chat">{file.thread_title}</span>
          </span>
          <span className="sharedf__meta">
            <Sender author={file.author} />
            <span>{when(file.created_at)}</span>
            {file.bytes > 0 && <span>{formatBytes(file.bytes)}</span>}
          </span>
        </div>
        <SharedActions file={file} all />
      </div>
      <Body key={file.media_id} file={file} />
    </section>
  );
}
