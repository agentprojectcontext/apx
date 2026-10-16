import { DOCUMENT_MAX_BYTES } from "@apx/protocol/client";
import { Button, EmptyState, IconButton, Icons, MarkdownView } from "@apx/ui";
import { useEffect, useMemo, useState } from "react";
import { client } from "../data/client.ts";
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
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [thread]);
  const documents = useMemo(
    () => withStored(loaded, stored && stored.thread === thread ? stored.docs : []),
    [loaded, stored, thread],
  );
  const current = documents.find((p) => p.media_id === selected) ?? documents[0];
  if (!current)
    return (
      <div className="sidepanel__body">
        <EmptyState icon={<Icons.FileText />} title={t("document.empty")}>
          {t("document.emptyBody")}
        </EmptyState>
      </div>
    );
  return (
    <div className="documentpanel">
      {documents.length > 1 && (
        <select
          className="documentpanel__select"
          aria-label={t("document.choose")}
          value={current.media_id}
          onChange={(e) => go.document(e.target.value)}
        >
          {documents.map((p) => (
            <option key={p.media_id} value={p.media_id}>
              {p.title} · {p.name}
            </option>
          ))}
        </select>
      )}
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

function DocumentBody({ doc }: { doc: DocRef }) {
  const t = useT();
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
        <span className="documentpanel__filename" title={doc.name}>
          {doc.name}
        </span>
        <div className="documentpanel__actions">
          <IconButton
            size="sm"
            label={raw ? t("document.view") : t("document.source")}
            icon={raw ? <Icons.Eye size={14} /> : <Icons.Code size={14} />}
            onClick={() => setRaw((v) => !v)}
          />
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
