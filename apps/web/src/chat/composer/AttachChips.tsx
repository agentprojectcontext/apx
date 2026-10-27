import { Dialog, IconButton, Icons } from "@apx/ui";
import { useState } from "react";
import { useT } from "../../i18n/index.ts";
import { AudioPart } from "../parts/lazyAudio.tsx";
import { useMediaUrl } from "../parts/useMediaUrl.ts";
import type { Chip } from "./useAttachments.ts";
import "./AttachChips.css";

/** The files waiting to go: a thumbnail or the file's name, a spinner while uploading, the reason when refused. */
export function AttachChips({ chips, onRemove }: { chips: Chip[]; onRemove(key: string): void }) {
  const t = useT();
  return (
    <ul className="attchips" aria-label={t("composer.attachments")}>
      {chips.map((c) => (
        <li
          key={c.key}
          className={`attchip${c.media?.kind === "audio" ? " is-audio" : ""}${c.error ? " is-error" : ""}${c.media || c.error ? "" : " is-loading"}`}
          title={c.error ?? c.name}
        >
          {c.media?.kind === "audio" ? (
            <AudioPart part={{ type: "audio", media_id: c.media.id, mime: c.media.mime }} />
          ) : c.image && (c.preview || c.media) ? (
            <DraftImage chip={c} />
          ) : (
            <span className="attchip__icon">
              {c.error ? (
                <Icons.TriangleAlert size={14} />
              ) : c.image ? (
                <Icons.Image size={14} />
              ) : (
                <Icons.FileText size={14} />
              )}
            </span>
          )}
          {c.media?.kind !== "audio" && (
            <span className="attchip__name" role={c.error ? "alert" : undefined}>
              {c.error ?? c.name}
            </span>
          )}
          {!c.media && !c.error && <Icons.LoaderCircle size={12} className="attchip__spin" />}
          <IconButton
            size="sm"
            className="attchip__x"
            label={t("composer.removeFile", { name: c.name })}
            icon={<Icons.X size={12} />}
            onClick={() => onRemove(c.key)}
          />
        </li>
      ))}
    </ul>
  );
}

function DraftImage({ chip }: { chip: Chip }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const stored = useMediaUrl(chip.preview ? undefined : chip.media?.id);
  const src = chip.preview ?? stored;
  return (
    <>
      <button
        type="button"
        className="attchip__preview"
        aria-label={t("composer.previewFile", { name: chip.name })}
        onClick={() => setOpen(true)}
      >
        {src ? <img className="attchip__thumb" src={src} alt="" /> : <Icons.Image size={14} />}
      </button>
      {open && (
        <Dialog
          bare
          open
          title={chip.name}
          closeLabel={t("common.close")}
          onOpenChange={setOpen}
          className="draftimage"
        >
          {src && <img src={src} alt={chip.name} />}
        </Dialog>
      )}
    </>
  );
}
