import { DOCUMENT_MAX_BYTES } from "@apx/protocol/client";
import { Button, EmptyState, Icons, MarkdownView } from "@apx/ui";
import { useEffect, useMemo, useState } from "react";
import { mediaUrl } from "../data/media.ts";
import { useData } from "../data/state.ts";
import { useT } from "../i18n/index.ts";
import { go, useNav } from "../shell/nav.ts";
import { chatDocuments, type DocumentPart } from "./documents.ts";

export function DocumentPanel() {
  const t = useT();
  const thread = useNav((s) => s.threadId);
  const selected = useNav((s) => s.panelDocument);
  const messages = useData((s) => (thread ? s.messages[thread] : undefined));
  const documents = useMemo(() => (thread && messages ? chatDocuments(messages, thread) : []), [messages, thread]);
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
              {p.document.title} · {p.name}
            </option>
          ))}
        </select>
      )}
      <DocumentBody key={current.media_id} part={current} />
    </div>
  );
}

function DocumentBody({ part }: { part: DocumentPart }) {
  const t = useT();
  const [source, setSource] = useState<string>();
  const [error, setError] = useState(false);
  const [raw, setRaw] = useState(part.document.format === "text");
  const [request, setRequest] = useState({ id: part.media_id });
  const [downloadFailed, setDownloadFailed] = useState(false);
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
  const download = async () => {
    setDownloadFailed(false);
    try {
      const a = document.createElement("a");
      a.href = await mediaUrl(part.media_id);
      a.download = part.name;
      a.click();
    } catch {
      setDownloadFailed(true);
    }
  };
  return (
    <section className="documentpanel__page" aria-label={part.document.title}>
      <header className="documentpanel__head">
        <h2>{part.document.title}</h2>
        <span className="documentpanel__filename">{part.name}</span>
        <div className="documentpanel__actions">
          <Button size="sm" variant="ghost" onClick={() => setRaw((v) => !v)}>
            {raw ? t("document.view") : t("document.source")}
          </Button>
          <Button size="sm" variant="ghost" onClick={() => void download()}>
            <Icons.Download size={14} /> {t("document.download")}
          </Button>
        </div>
      </header>
      {downloadFailed && <p role="alert">{t("document.failed")}</p>}
      {error ? (
        <div className="documentpanel__status" role="alert">
          <p>{t("document.failed")}</p>
          <Button size="sm" onClick={() => setRequest({ id: part.media_id })}>
            {t("document.retry")}
          </Button>
        </div>
      ) : source === undefined ? (
        <p className="documentpanel__status" role="status">
          {t("document.loading")}
        </p>
      ) : raw ? (
        <pre className="documentpanel__source">{source}</pre>
      ) : (
        <MarkdownView source={source} className="documentpanel__content" />
      )}
    </section>
  );
}
