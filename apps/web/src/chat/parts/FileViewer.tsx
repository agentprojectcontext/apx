import { Dialog, Skeleton } from "@apx/ui";
import { Suspense, useEffect, useState } from "react";
import { mediaUrl } from "../../data/media.ts";
import { useT } from "../../i18n/index.ts";
import { CodeView } from "../../lazy.ts";
import type { Viewable } from "./fileKind.ts";

/**
 * A file from the chat, open in a dialog: a PDF in the viewer, text (code, CSV, Markdown, a page's HTML) as text with
 * its colors and line numbers, never run.
 */
export function FileViewer({
  mediaId,
  name,
  kind,
  onClose,
}: {
  mediaId: string;
  name: string;
  kind: Viewable;
  onClose(): void;
}) {
  const t = useT();
  const [file, setFile] = useState<{ url: string; text?: string } | "failed">();
  useEffect(() => {
    let stop = false;
    mediaUrl(mediaId)
      .then(async (url) => ({ url, ...(kind === "text" ? { text: await (await fetch(url)).text() } : {}) }))
      .then(
        (f) => !stop && setFile(f),
        () => !stop && setFile("failed"),
      );
    return () => {
      stop = true;
    };
  }, [mediaId, kind]);
  return (
    <Dialog
      open
      onOpenChange={(open) => !open && onClose()}
      size="xl"
      title={name}
      closeLabel={t("common.close")}
      className="fileviewer"
    >
      {file === "failed" ? (
        <p className="fileviewer__failed">{t("file.unavailable")}</p>
      ) : !file ? (
        <Skeleton shape="block" height={240} />
      ) : file.text !== undefined ? (
        <div className="fileviewer__text">
          <Suspense fallback={<Skeleton shape="block" height={240} />}>
            <CodeView path={name} text={file.text} editable={false} snippet />
          </Suspense>
        </div>
      ) : (
        <iframe className="fileviewer__pdf" src={file.url} title={name} />
      )}
    </Dialog>
  );
}
