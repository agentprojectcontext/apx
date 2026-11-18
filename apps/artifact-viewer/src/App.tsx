import { ApxProvider, Button, Icons } from "@apx/ui";
import { useEffect, useState } from "react";
import { usePublication } from "./usePublication.ts";

const texts = {
  en: {
    published: "Published copy",
    open: "Open in APX",
    hint: "Download the file, then open it in APX.",
    loading: "Opening this copy…",
    missing: "This copy isn't available",
    missingHint: "The link may have been removed. Ask the person who shared it.",
    offline: "Couldn't open this copy",
    offlineHint: "Check your connection and try again.",
    retry: "Try again",
    preview: "Published artifact",
    noPreview: "This browser can't preview the copy",
    downloading: "Preparing download…",
  },
  es: {
    published: "Copia publicada",
    open: "Abrir en APX",
    hint: "Descargá el archivo y abrilo en APX.",
    loading: "Abriendo esta copia…",
    missing: "Esta copia no está disponible",
    missingHint: "Es posible que hayan quitado el enlace. Consultá con quien te lo compartió.",
    offline: "No pudimos abrir esta copia",
    offlineHint: "Revisá tu conexión y volvé a intentar.",
    retry: "Volver a intentar",
    preview: "Artifact publicado",
    noPreview: "Este navegador no puede mostrar la copia",
    downloading: "Preparando descarga…",
  },
};

export function App() {
  const [language, setLanguage] = useState<"en" | "es">(navigator.language.startsWith("es") ? "es" : "en");
  const t = texts[language];
  const { copy, status, downloading, download, validCode, retry } = usePublication(window.location.pathname.slice(1));
  useEffect(() => {
    document.documentElement.lang = language;
  }, [language]);
  return (
    <ApxProvider fill look="minimal" mode="light">
      <main className="public-copy">
        <header className="public-copy__header">
          <div className="public-copy__top">
            <span className="public-copy__brand">
              APX <span>· {t.published}</span>
            </span>
            <Button size="sm" variant="ghost" onClick={() => setLanguage(language === "en" ? "es" : "en")}>
              {language === "en" ? "Español" : "English"}
            </Button>
          </div>
          {copy && (
            <div className="public-copy__heading">
              <div>
                <h1>{copy.bundle.manifest.title}</h1>
                <p>{t.hint}</p>
              </div>
              <Button
                leadingIcon={<Icons.Download size={16} />}
                disabled={!copy || status !== "ready" || downloading}
                onClick={() => void download()}
              >
                {downloading ? t.downloading : t.open}
              </Button>
            </div>
          )}
        </header>
        {status === "ready" && copy ? (
          "credentialless" in HTMLIFrameElement.prototype ? (
            <iframe
              {...{ credentialless: true }}
              key={copy.sha256}
              title={t.preview}
              src="/runner.html"
              sandbox="allow-scripts"
              referrerPolicy="no-referrer"
              className="public-copy__frame"
              onLoad={(event) => {
                event.currentTarget.contentWindow?.postMessage(
                  { type: "apx-public-copy", html: copy.bundle.html, state: copy.bundle.state ?? {} },
                  "*",
                );
              }}
            />
          ) : (
            <section className="public-copy__status">
              <h2>{t.noPreview}</h2>
            </section>
          )
        ) : (
          <section className="public-copy__status" aria-live="polite" aria-busy={status === "loading"}>
            <h1>{status === "loading" ? t.loading : status === "missing" ? t.missing : t.offline}</h1>
            {status !== "loading" && <p>{status === "missing" ? t.missingHint : t.offlineHint}</p>}
            {status !== "loading" && validCode && (
              <Button variant="secondary" onClick={retry}>
                {t.retry}
              </Button>
            )}
          </section>
        )}
      </main>
    </ApxProvider>
  );
}
