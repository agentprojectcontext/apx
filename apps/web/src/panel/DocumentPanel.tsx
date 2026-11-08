import "../styles/document-panel.css";
import { DOCUMENT_MAX_BYTES } from "@apx/protocol/client";
import { Button, EmptyState, IconButton, Icons, MarkdownView } from "@apx/ui";
import { useEffect, useMemo, useState } from "react";
import { useMarkdownLabels } from "../common/useMarkdownLabels.ts";
import { client } from "../data/client.ts";
import { mediaUrl } from "../data/media.ts";
import { useData } from "../data/state.ts";
import { useT } from "../i18n/index.ts";
import { go, useNav } from "../shell/nav.ts";
import { DocumentActions } from "./DocumentActions.tsx";
import { chatDocuments, type DocRef, withStored } from "./documents.ts";
import { closeTab, useOpenTabs } from "./openTabs.ts";
import { LIST_TAB, PanelList, PanelRow, PanelTabs } from "./PanelTabs.tsx";

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
  const key = thread && `document:${thread}`;
  const open = useOpenTabs(key, selected);
  const current = selected ? documents.find((p) => p.media_id === selected) : undefined;
  // An old document may be one only the core lists: its tab waits for it under a plain name.
  const tabs = open.flatMap((id) => {
    const doc = documents.find((d) => d.media_id === id);
    return doc ? [{ id, label: doc.title }] : !ready && id === selected ? [{ id, label: t("document.label") }] : [];
  });
  return (
    <>
      <PanelTabs
        label={t("document.list")}
        list={t("panelTabs.all", { n: documents.length })}
        tabs={tabs}
        value={current || (selected && !ready) ? selected : LIST_TAB}
        onSelect={(id) => go.document(id === LIST_TAB ? undefined : id)}
        onClose={(id) => {
          if (key) closeTab(key, id);
          if (id === selected) go.document();
        }}
      />
      {current ? (
        <div className="documentpanel">
          <DocumentBody key={current.media_id} doc={current} />
        </div>
      ) : selected && !ready ? (
        <div className="documentpanel">
          <p className="documentpanel__status" role="status">
            {t("document.loading")}
          </p>
        </div>
      ) : !documents.length ? (
        <div className="sidepanel__body">
          <EmptyState icon={<Icons.FileText />} title={t("document.empty")}>
            {t("document.emptyBody")}
          </EmptyState>
        </div>
      ) : (
        <PanelList label={t("document.list")}>
          {documents.map((d) => (
            <div key={d.media_id} className="documentpanel__row">
              <PanelRow
                leading={<Icons.FileText size={16} />}
                title={d.title}
                description={<span className="plist__mono">{d.source?.path ?? d.name}</span>}
                onClick={() => go.document(d.media_id)}
              />
              <div className="documentpanel__rowactions">
                <DocumentActions doc={d} thread={thread} />
              </div>
            </div>
          ))}
        </PanelList>
      )}
    </>
  );
}

function DocumentBody({ doc }: { doc: DocRef }) {
  const t = useT();
  const thread = useNav((s) => s.threadId);
  const [raw, setRaw] = useState(doc.format === "text");
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
          <DocumentActions doc={doc} thread={thread} />
        </div>
      </header>
      <DocumentText doc={doc} raw={raw} />
    </section>
  );
}

/** A document's text, read from its file: rendered markdown, or its source as written. */
export function DocumentText({ doc, raw }: { doc: DocRef; raw: boolean }) {
  const t = useT();
  const mdLabels = useMarkdownLabels();
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
    <MarkdownView source={source} className="documentpanel__content" labels={mdLabels} />
  );
}
