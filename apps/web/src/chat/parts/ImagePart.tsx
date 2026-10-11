import type { Part } from "@apx/protocol";
import { ContextMenu, Dialog, Icons, type MenuEntry, Skeleton } from "@apx/ui";
import { useState } from "react";
import { notify } from "../../data/notices.ts";
import { useT } from "../../i18n/index.ts";
import { useLinkItems } from "../LinkMenu.tsx";
import { useMediaUrl } from "./useMediaUrl.ts";

const SAFE = /^(https?:|data:image\/)/i;

/**
 * An image from the web (only http(s) or inline data) or one APX made (loaded through media.get).
 * A click shows it full size over the app; a right-click opens, saves or copies it.
 */
export function ImagePart({ part }: { part: Extract<Part, { type: "image" }> }) {
  const own = useMediaUrl(part.media_id);
  const src = part.media_id ? own : part.url && SAFE.test(part.url) ? part.url : undefined;
  if (part.media_id && !own) return <Skeleton className="imagepart imagepart--loading" />;
  if (!src) return null;
  return <ImageView src={src} alt={part.alt} name={part.media_id ?? "image"} web={!part.media_id} />;
}

function ImageView({ src, alt, name, web }: { src: string; alt?: string; name: string; web: boolean }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const linkItems = useLinkItems(src);
  const items: MenuEntry[] = [
    { label: t("image.view"), icon: <Icons.Maximize2 size={14} />, onSelect: () => setOpen(true) },
    { type: "separator" },
    // A web image opens where a link would; APX's own is a local object URL, so it is saved instead.
    ...(web && /^https?:/i.test(src)
      ? linkItems
      : [{ label: t("image.save"), icon: <Icons.Download size={14} />, onSelect: () => void save(src, name) }]),
    {
      label: t("image.copy"),
      icon: <Icons.Image size={14} />,
      onSelect: () =>
        void copyImage(src).then(
          () => notify(t("image.copied"), "info"),
          () => notify(t("image.copyFailed"), "error"),
        ),
    },
  ];
  return (
    <>
      <ContextMenu items={items} render={<button type="button" className="imagepart" onClick={() => setOpen(true)} />}>
        <img src={src} alt={alt} loading="lazy" />
      </ContextMenu>
      <Dialog
        bare
        open={open}
        onOpenChange={setOpen}
        title={alt || t("image.view")}
        closeLabel={t("common.close")}
        className="imageviewer"
      >
        <ContextMenu items={items.slice(2)} render={<div className="imageviewer__frame" />}>
          <img src={src} alt={alt} />
        </ContextMenu>
      </Dialog>
    </>
  );
}

/** Saves through a download link, named after the media file with the extension its type gives. */
async function save(src: string, name: string): Promise<void> {
  const type = (await (await fetch(src)).blob()).type;
  const a = document.createElement("a");
  a.href = src;
  a.download = `${name}.${type.split("/")[1]?.replace("jpeg", "jpg") || "png"}`;
  a.click();
}

/**
 * The clipboard takes PNG everywhere, so other formats are redrawn as PNG first. It gets a promise, written right
 * away, so the click still counts as the user's gesture while the image loads.
 */
function copyImage(src: string): Promise<void> {
  const png = fetch(src)
    .then((r) => r.blob())
    .then((blob) =>
      blob.type === "image/png"
        ? blob
        : createImageBitmap(blob).then((bmp) => {
            const canvas = new OffscreenCanvas(bmp.width, bmp.height);
            canvas.getContext("2d")?.drawImage(bmp, 0, 0);
            return canvas.convertToBlob({ type: "image/png" });
          }),
    );
  return navigator.clipboard.write([new ClipboardItem({ "image/png": png })]);
}
