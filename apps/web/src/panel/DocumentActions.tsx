// A document's actions wherever it shows (its page, the documents list, its card in the chat): its folder, open it
// apart and download it.
import { IconButton, Icons } from "@apx/ui";
import { client } from "../data/client.ts";
import { coreOnThisComputer, type FileWhere, openFile, revealFile } from "../data/files.ts";
import { mediaUrl } from "../data/media.ts";
import { notify } from "../data/notices.ts";
import { useT } from "../i18n/index.ts";
import { go } from "../shell/nav.ts";
import type { DocRef } from "./documents.ts";

/** Saves the document's file as it is. */
export async function downloadDocument(doc: DocRef): Promise<void> {
  const a = document.createElement("a");
  a.href = await mediaUrl(doc.media_id);
  a.download = doc.name;
  a.click();
}

/** Shows the document's text in a new browser tab (a browser only: the desktop app opens no blank windows). */
async function openInTab(doc: DocRef): Promise<void> {
  const tab = window.open("", "_blank");
  const text = await (await fetch(await mediaUrl(doc.media_id))).text();
  const url = URL.createObjectURL(new Blob([text], { type: "text/plain;charset=utf-8" }));
  if (tab) tab.location.href = url;
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

const whereOf = (doc: DocRef, thread: string | undefined): FileWhere | undefined =>
  thread && doc.source ? { thread, ...(doc.source.scratch && { scratch: true }) } : undefined;

/** In its app beside the core (the file itself when the document names it, else a copy), or in a browser tab. */
async function openApart(doc: DocRef, thread: string | undefined): Promise<void> {
  const where = whereOf(doc, thread);
  if (!coreOnThisComputer()) return openInTab(doc);
  if (where && doc.source) return openFile(where, doc.source.path);
  await client.call("documents.open", { media_id: doc.media_id });
}

/** Only where it can: beside the core, or in a browser (the desktop app of a far core has neither). */
const canOpenApart = () => coreOnThisComputer() || !window.apxDesktop;

export function DocumentActions({ doc, thread }: { doc: DocRef; thread: string | undefined }) {
  const t = useT();
  const local = coreOnThisComputer();
  const where = whereOf(doc, thread);
  const source = doc.source?.path;
  const failed = () => notify(t("document.failed"));
  return (
    <>
      {where && source && (
        <IconButton
          size="sm"
          label={local ? t("files.reveal") : t("document.showFiles")}
          icon={<Icons.FolderOpen size={14} />}
          onClick={() => (local ? void revealFile(where, source) : go.panel("files"))}
        />
      )}
      {canOpenApart() && (
        <IconButton
          size="sm"
          label={local ? t("document.open") : t("document.openTab")}
          icon={<Icons.ExternalLink size={14} />}
          onClick={() => void openApart(doc, thread).catch(failed)}
        />
      )}
      <IconButton
        size="sm"
        label={t("document.download")}
        icon={<Icons.Download size={14} />}
        onClick={() => void downloadDocument(doc).catch(failed)}
      />
    </>
  );
}
