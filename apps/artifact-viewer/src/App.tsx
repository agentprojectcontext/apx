import { ApxProvider, Button, ConfirmDialog } from "@apx/ui";
import { useEffect, useMemo, useState } from "react";
import { ownCopy, signInConfig, stopSharing, useAccount } from "./account.ts";
import { Bar } from "./Bar.tsx";
import { texts } from "./texts.ts";
import { usePublication } from "./usePublication.ts";

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

/** Opens apx://; when the page keeps the focus a moment later, APX is likely not on this computer. */
function openInApx(code: string, missed: () => void) {
  let left = false;
  const away = () => {
    left = true;
  };
  window.addEventListener("blur", away, { once: true });
  document.addEventListener("visibilitychange", away, { once: true });
  window.location.href = `apx://artifact/${code}`;
  window.setTimeout(() => {
    window.removeEventListener("blur", away);
    document.removeEventListener("visibilitychange", away);
    if (!left) missed();
  }, 1600);
}

export function App() {
  const [language, setLanguage] = useState<"en" | "es">(navigator.language.startsWith("es") ? "es" : "en");
  const mode = useSystemMode();
  const t = texts[language];
  const code = window.location.pathname.slice(1);
  const { copy, status, downloading, download, validCode, retry } = usePublication(code);
  const config = useMemo(() => signInConfig(), []);
  const account = useAccount(config);
  const [own, setOwn] = useState<{ revision: string }>();
  const [asking, setAsking] = useState(false);
  const [stopped, setStopped] = useState(false);
  const [note, setNote] = useState<string>();
  const [notOpened, setNotOpened] = useState(false);
  useEffect(() => {
    document.documentElement.lang = language;
  }, [language]);
  useEffect(() => {
    document.documentElement.style.colorScheme = mode;
  }, [mode]);
  const version = copy?.sha256;
  useEffect(() => {
    setOwn(undefined);
    if (!account.person || !version) return;
    let live = true;
    void ownCopy(code, account.person).then((result) => live && setOwn(result));
    return () => {
      live = false;
    };
  }, [account.person, code, version]);
  useEffect(() => {
    if (account.failed) setNote(t.signInFailed);
  }, [account.failed, t]);
  useEffect(() => {
    if (!note) return;
    const timer = window.setTimeout(() => setNote(undefined), 2500);
    return () => window.clearTimeout(timer);
  }, [note]);
  // A copy already on screen stays while the page confirms it again (returning from another window).
  const showing = !stopped && copy && (status === "ready" || status === "loading");
  const usable = !stopped && Boolean(copy) && status === "ready" && !downloading;
  const title = copy?.bundle.manifest.title;
  return (
    <ApxProvider fill look="minimal" mode={mode}>
      <main className="public-copy">
        <Bar
          t={t}
          title={stopped ? undefined : title}
          usable={usable}
          downloading={downloading}
          owner={Boolean(own) && !stopped}
          person={account.person}
          signIn={
            config && {
              busy: account.busy,
              start: () => void account.signIn(),
              prepare: account.prepare,
              out: () => void account.signOut(),
            }
          }
          onOpen={() => openInApx(code, () => setNotOpened(true))}
          onDownload={() => void download()}
          onCopyLink={() =>
            void navigator.clipboard.writeText(`${window.location.origin}/${code}`).then(() => setNote(t.copied))
          }
          onStop={() => setAsking(true)}
          onLanguage={() => setLanguage(language === "en" ? "es" : "en")}
        />
        {notOpened && (
          <div className="public-copy__notice" role="status">
            <span>{t.notOpened}</span>
            <Button size="sm" onClick={() => window.open(t.getApxUrl, "_blank", "noopener")}>
              {t.getApx}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setNotOpened(false)}>
              {t.dismiss}
            </Button>
          </div>
        )}
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
            <h1>
              {stopped ? t.stopped : status === "loading" ? t.loading : status === "missing" ? t.missing : t.offline}
            </h1>
            {(stopped || status !== "loading") && (
              <p>{stopped ? t.stoppedHint : status === "missing" ? t.missingHint : t.offlineHint}</p>
            )}
            {!stopped && status !== "loading" && validCode && (
              <Button variant="secondary" onClick={retry}>
                {t.retry}
              </Button>
            )}
          </section>
        )}
        {note && (
          <div className="public-copy__toast" role="status">
            {note}
          </div>
        )}
        {asking && own && account.person && (
          <ConfirmDialog
            title={t.stopTitle(title ?? t.published)}
            description={t.stopBody}
            confirmLabel={t.stopConfirm}
            cancelLabel={t.cancel}
            onConfirm={async () => {
              if (!account.person) return;
              try {
                await stopSharing(code, account.person, own.revision);
                setStopped(true);
              } catch {
                setNote(t.stopFailed);
              }
            }}
            onClose={() => setAsking(false)}
          />
        )}
      </main>
    </ApxProvider>
  );
}
