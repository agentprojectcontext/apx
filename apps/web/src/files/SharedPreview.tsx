import type { SharedFile } from "@apx/protocol";
import { Dialog, EmptyState, IconButton, Icons, MediaLoader, mediaKindOf, ProjectTile } from "@apx/ui";
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

/** One file over the list, on a dark backdrop with its details and actions beside it; closing leaves the list as it was. */
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
  const name = file.name || t(ONE[file.kind]);
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLElement && e.target.closest("input, textarea, video, audio")) return;
      if (e.key === "ArrowLeft") onStep?.(-1);
      else if (e.key === "ArrowRight") onStep?.(1);
    };
    // Capture: the dialog handles its own keys before they would bubble up here.
    window.addEventListener("keydown", key, true);
    return () => window.removeEventListener("keydown", key, true);
  }, [onStep]);
  return (
    <Dialog
      bare
      open
      onOpenChange={(o) => !o && onBack()}
      title={name}
      closeLabel={t("shared.close")}
      className="sharedlb"
    >
      <div className="sharedf__lbstage">
        {onStep && (
          <IconButton
            className="sharedf__lbstep is-prev"
            label={t("shared.prev")}
            icon={<Icons.ChevronLeft size={20} />}
            onClick={() => onStep(-1)}
          />
        )}
        <Body key={file.media_id} file={file} />
        {onStep && (
          <IconButton
            className="sharedf__lbstep is-next"
            label={t("shared.next")}
            icon={<Icons.ChevronRight size={20} />}
            onClick={() => onStep(1)}
          />
        )}
      </div>
      <aside className="sharedf__lbside">
        <span className="sharedf__lbkind">
          {kindIcon(file.kind, 14)}
          {t(ONE[file.kind])}
        </span>
        <h2 className="sharedf__lbname">{name}</h2>
        <dl className="sharedf__facts">
          <dt>{t("shared.fact.project")}</dt>
          <dd className="sharedf__project">
            <ProjectTile
              tone={projectTone(file.project_id ?? DEFAULT_PID)}
              initial={projectInitial(project)}
              size={16}
            />
            {project}
          </dd>
          <dt>{t("shared.fact.chat")}</dt>
          <dd>{file.thread_title}</dd>
          <dt>{t("shared.fact.from")}</dt>
          <dd>
            <Sender author={file.author} size={20} />
          </dd>
          <dt>{t("shared.fact.when")}</dt>
          <dd>{when(file.created_at)}</dd>
          {file.bytes > 0 && (
            <>
              <dt>{t("shared.fact.size")}</dt>
              <dd>{formatBytes(file.bytes)}</dd>
            </>
          )}
        </dl>
        <SharedActions file={file} all labeled />
      </aside>
    </Dialog>
  );
}
