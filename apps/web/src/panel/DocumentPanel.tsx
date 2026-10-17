import { DOCUMENT_MAX_BYTES } from "@apx/protocol/client";
import { Button, EmptyState, IconButton, Icons, MarkdownView } from "@apx/ui";
import { useEffect, useMemo, useState } from "react";
import { client } from "../data/client.ts";
import { coreOnThisComputer, openFile, revealFile } from "../data/files.ts";
import { mediaUrl } from "../data/media.ts";
import { useData } from "../data/state.ts";
import { useT } from "../i18n/index.ts";
import { go, useNav } from "../shell/nav.ts";
import { chatDocuments, type DocRef, withStored } from "./documents.ts";

export function DocumentPanel() {
  const t = useT();
  const thread = useNav((s) => s.threadId);
  const selected = useNav((s) => s.panelDocument);
  const messages = useData((s) => (thread ? s.messages[thread] : undefined));
  const loaded = useMemo(() => (thread && messages ? chatDocuments(messages, thread) : []), [messages, thread]);
  const [stored, setStored] = useState<{ thread: string; docs: DocRef[] }>();
  useEffect(() => {
    if (!thread) return;
    let active = true;
    client
      .call("documents.list", { thread_id: thread })
      .then((r) => active && setStored({ thread, docs: r.documents }))
      .catch(() => active && setStored({ thread, docs: [] }));
    return () => {
      active = false;
    };
  }, [thread]);
  const documents = useMemo(
    () => withStored(loaded, stored && stored.thread === thread ? stored.docs : []),
    [loaded, stored, thread],
  );
  const ready = stored?.thread === thread;
  const current = selected ? documents.find((p) => p.media_id === selected) : undefined;
  if (!documents.length && (ready || !selected))
    return (
      <div className="sidepanel__body">
        <EmptyState icon={<Icons.FileText />} title={t("document.empty")}>
          {t("document.emptyBody")}
        </EmptyState>
      </div>
    );
  // An old document may be one only the core lists: wait for it before falling back to the list.
  if (selected && !current && !ready)
    return (
      <div className="documentpanel">
        <p className="documentpanel__status" role="status">
          {t("document.loading")}
        </p>
      </div>
    );
  if (!current)
    return (
      <div className="documentpanel">
        <ul className="documentpanel__list" aria-label={t("document.list")}>
          {documents.map((d) => (
            <li key={d.media_id}>
              <button type="button" className="documentpanel__item" onClick={() => go.document(d.media_id)}>
                <Icons.FileText size={16} />
                <span className="documentpanel__itemtext">
                  <span className="documentpanel__itemtitle">{d.title}</span>
                  <span className="documentpanel__filename">{d.name}</span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      </div>
    );
  return (
    <div className="documentpanel">
      <button type="button" className="documentpanel__back" onClick={() => go.document()}>
        <Icons.ArrowLeft size={14} />
        {t("document.back", { n: documents.length })}
      </button>
      <DocumentBody key={current.media_id} doc={current} />
    </div>
  );
}

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

/** Where the file is and how to open it apart: Finder and its app beside the core, else the chat's files and a tab. */
function DocumentPlaces({ doc, thread }: { doc: DocRef; thread: string | undefined }) {
  const t = useT();
  const local = coreOnThisComputer();
  const where = thread && doc.source ? { thread, ...(doc.source.scratch && { scratch: true }) } : undefined;
  const path = doc.source?.path;
  return (
    <>
      {where && path && (
        <IconButton
          size="sm"
          label={local ? t("files.reveal") : t("document.showFiles")}
          icon={<Icons.FolderOpen size={14} />}
          onClick={() => (local ? void revealFile(where, path) : go.panel("files"))}
        />
      )}
      {local && where && path ? (
        <IconButton
          size="sm"
          label={t("document.open")}
          icon={<Icons.ExternalLink size={14} />}
          onClick={() => void openFile(where, path)}
        />
      ) : (
        !window.apxDesktop && (
          <IconButton
            size="sm"
            label={t("document.openTab")}
            icon={<Icons.ExternalLink size={14} />}
            onClick={() => void openInTab(doc)}
          />
        )
      )}
    </>
  );
}

function DocumentBody({ doc }: { doc: DocRef }) {
  const t = useT();
  const thread = useNav((s) => s.threadId);
  const [raw, setRaw] = useState(doc.format === "text");
  const [downloadFailed, setDownloadFailed] = useState(false);
  const download = async () => {
    setDownloadFailed(false);
    try {
      await downloadDocument(doc);
    } catch {
      setDownloadFailed(true);
    }
  };
  return (
    <section className="documentpanel__page" aria-label={doc.title}>
      <header className="documentpanel__head">
        <h2>{doc.title}</h2>
        {/* Icons with tooltips: a narrow panel keeps the name on one line instead of breaking it per letter. */}
        <span className="documentpanel__filename" title={doc.source?.path ?? doc.name}>
          {doc.source?.path ?? doc.name}
        </span>
        <div className="documentpanel__actions">
          <IconButton
            size="sm"
            label={raw ? t("document.view") : t("document.source")}
            icon={raw ? <Icons.Eye size={14} /> : <Icons.Code size={14} />}
            onClick={() => setRaw((v) => !v)}
          />
          <DocumentPlaces doc={doc} thread={thread} />
          <IconButton
            size="sm"
            label={t("document.download")}
            icon={<Icons.Download size={14} />}
            onClick={() => void download()}
          />
        </div>
      </header>
      {downloadFailed && <p role="alert">{t("document.failed")}</p>}
      <DocumentText doc={doc} raw={raw} />
    </section>
  );
}

/** A document's text, read from its file: rendered markdown, or its source as written. */
export function DocumentText({ doc, raw }: { doc: DocRef; raw: boolean }) {
  const t = useT();
  const [source, setSource] = useState<string>();
  const [error, setError] = useState(false);
  const [request, setRequest] = useState({ id: doc.media_id });
  useEffect(() => {
    let active = true;
    setError(false);
    void mediaUrl(request.id)
      .then(async (url) => {
        const bytes = new Uint8Array(await (await fetch(url)).arrayBuffer());
        if (bytes.length > DOCUMENT_MAX_BYTES || bytes.includes(0)) throw new Error("Invalid document");
        const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
        if (active) setSource(text);
      })
      .catch(() => {
        if (active) setError(true);
      });
    return () => {
      active = false;
    };
  }, [request]);
  if (error)
    return (
      <div className="documentpanel__status" role="alert">
        <p>{t("document.failed")}</p>
        <Button size="sm" onClick={() => setRequest({ id: doc.media_id })}>
          {t("document.retry")}
        </Button>
      </div>
    );
  if (source === undefined)
    return (
      <p className="documentpanel__status" role="status">
        {t("document.loading")}
      </p>
    );
  return raw ? (
    <pre className="documentpanel__source">{source}</pre>
  ) : (
    <MarkdownView source={source} className="documentpanel__content" />
  );
}
