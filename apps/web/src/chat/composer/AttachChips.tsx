import { IconButton, Icons } from "@apx/ui";
import { useT } from "../../i18n/index.ts";
import { AudioPart } from "../parts/lazyAudio.tsx";
import type { Chip } from "./useAttachments.ts";

/** The files waiting to go: a thumbnail or the file's name, a spinner while uploading, the reason when refused. */
export function AttachChips({ chips, onRemove }: { chips: Chip[]; onRemove(key: string): void }) {
  const t = useT();
  return (
    <ul className="attchips" aria-label={t("composer.attachments")}>
      {chips.map((c) => (
        <li
          key={c.key}
          className={`attchip${c.media?.kind === "audio" ? " is-audio" : ""}${c.error ? " is-error" : ""}${c.media ? "" : " is-loading"}`}
          title={c.error ?? c.name}
        >
          {c.media?.kind === "audio" ? (
            <AudioPart part={{ type: "audio", media_id: c.media.id, mime: c.media.mime }} />
          ) : c.preview ? (
            <img className="attchip__thumb" src={c.preview} alt="" />
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
          {c.media?.kind !== "audio" && <span className="attchip__name">{c.error ?? c.name}</span>}
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
