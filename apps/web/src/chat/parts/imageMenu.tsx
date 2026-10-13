// The right-click menu of a picture in the chat (its grid and its viewer, chat/parts/MediaGroup.tsx).
import { Icons, type MenuEntry } from "@apx/ui";
import { notify } from "../../data/notices.ts";
import { useT } from "../../i18n/index.ts";
import { useLinkItems } from "../LinkMenu.tsx";

/**
 * What a right-click on a picture offers: view it full size (`onView`, left out inside the viewer), open a web one where
 * a link would, save APX's own, or copy it.
 */
export function useImageMenu(src: string | undefined, name: string, web: boolean, onView?: () => void): MenuEntry[] {
  const t = useT();
  const linkItems = useLinkItems(src ?? "");
  if (!src) return [];
  return [
    ...(onView
      ? [
          { label: t("image.view"), icon: <Icons.Maximize2 size={14} />, onSelect: onView },
          { type: "separator" as const },
        ]
      : []),
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
