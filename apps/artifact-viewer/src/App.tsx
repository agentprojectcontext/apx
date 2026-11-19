import { ApxProvider, Button, Icons, Menu } from "@apx/ui";
import { useEffect, useState } from "react";
import { usePublication } from "./usePublication.ts";

const texts = {
  en: {
    published: "Published copy",
    options: "Copy options",
    language: "Español",
    open: "Open in APX",
    hint: "To open it in another APX (.apxart)",
    file: "Download file",
    loading: "Opening this copy…",
    missing: "This copy isn't available",
    missingHint: "The link may have been removed. Ask the person who shared it.",
    offline: "Couldn't open this copy",
    offlineHint: "Check your connection and try again.",
    retry: "Try again",
    preview: "Published artifact",
    downloading: "Preparing download…",
  },
  es: {
    published: "Copia publicada",
    options: "Opciones de la copia",
    language: "English",
    open: "Abrir en APX",
    hint: "Para abrirlo en otro APX (.apxart)",
    file: "Descargar archivo",
    loading: "Abriendo esta copia…",
    missing: "Esta copia no está disponible",
    missingHint: "Es posible que hayan quitado el enlace. Consultá con quien te lo compartió.",
    offline: "No pudimos abrir esta copia",
    offlineHint: "Revisá tu conexión y volvé a intentar.",
    retry: "Volver a intentar",
    preview: "Artifact publicado",
    downloading: "Preparando descarga…",
  },
};

/** Light or dark as this computer is, following it when it changes. */
function useSystemMode(): "light" | "dark" {
  const query = "(prefers-color-scheme: dark)";
  const [dark, setDark] = useState(() => window.matchMedia(query).matches);
  useEffect(() => {
    const media = window.matchMedia(query);
    const change = () => setDark(media.matches);
    media.addEventListener("change", change);
    return () => media.removeEventListener("change", change);
  }, []);
  return dark ? "dark" : "light";
}

export function App() {
  const [language, setLanguage] = useState<"en" | "es">(navigator.language.startsWith("es") ? "es" : "en");
  const mode = useSystemMode();
  const t = texts[language];
  const { copy, status, downloading, download, validCode, retry } = usePublication(window.location.pathname.slice(1));
  useEffect(() => {
    document.documentElement.lang = language;
  }, [language]);
  useEffect(() => {
    document.documentElement.style.colorScheme = mode;
  }, [mode]);
  // A copy already on screen stays while the page confirms it again (returning from another window).
  const showing = copy && (status === "ready" || status === "loading");
  const usable = Boolean(copy) && status === "ready" && !downloading;
  const openInApx = () => {
    window.location.href = `apx://artifact/${window.location.pathname.slice(1)}`;
  };
  return (
    <ApxProvider fill look="minimal" mode={mode}>
      <main className="public-copy">
        <header className="public-copy__bar">
          <Menu
            align="start"
            trigger={
              <button type="button" className="public-copy__title" aria-label={t.options}>
                <span className="public-copy__brand">APX</span>
                <span className="public-copy__name">{copy?.bundle.manifest.title ?? t.published}</span>
                <Icons.ChevronDown size={16} />
              </button>
            }
            items={[
              { label: t.open, icon: <Icons.ExternalLink size={16} />, disabled: !usable, onSelect: openInApx },
              {
                label: downloading ? t.downloading : t.file,
                description: t.hint,
                icon: <Icons.Download size={16} />,
                disabled: !usable,
                onSelect: () => void download(),
              },
              { type: "separator" },
              {
                label: t.language,
                icon: <Icons.Languages size={16} />,
                onSelect: () => setLanguage(language === "en" ? "es" : "en"),
              },
            ]}
          />
          {copy && (
            <Button size="sm" disabled={!usable} onClick={openInApx}>
              {t.open}
            </Button>
          )}
        </header>
        {showing ? (
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
