import { useCallback, useEffect, useState } from "react";
import { Download, Link2, Smartphone } from "lucide-react";
import { Section } from "../Section";
import { Button, Spinner } from "../ui";
import { buttonVariants } from "../ui/button";
import { Qr } from "../common/Qr";
import { useToast } from "../Toast";
import { usePersonaName } from "../../hooks/usePersonaName";
import { Pair } from "../../lib/api";
import { LINKS } from "../../constants";
import { cn } from "../../lib/cn";
import { t } from "../../i18n";

/**
 * Where the Android app comes from, and how it gets back in.
 *
 * Two different QRs, because they answer two different questions and pointing
 * one camera at the wrong one is the kind of confusion that ends in "it opened
 * the website again":
 *
 *   · DOWNLOAD — the APK on GitHub. For a phone with no app yet. Android only;
 *     an iPhone that scans it gets a file it cannot open.
 *   · PAIR — an `apx://pair` deep link, which the INSTALLED app claims. It
 *     carries the daemon address and a one-time code, so a phone whose pairing
 *     was lost (reinstall, cleared data, revoked token) is back in one scan
 *     without typing a URL on a phone keyboard. Scanned without the app
 *     installed it does nothing, which is why it is never the default.
 *
 * The web pairing QR — the one that opens the panel in a browser already
 * authenticated — is a third thing and lives where it always did, in Pair
 * device. This card is about the app.
 */
type Mode = "download" | "pair";

export function AndroidAppPanel() {
  const toast = useToast();
  const persona = usePersonaName();
  const [mode, setMode] = useState<Mode>("download");

  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast.success(t("access.copied"));
    } catch {
      // No clipboard without a secure context — show it to be selected by hand
      // rather than failing with nothing on screen.
      toast.info(text);
    }
  };

  // English on purpose, like the QVox card: this is a prompt for the model, not
  // UI copy. It loads UNSENT so it can be read and added to first.
  const askPersona = () =>
    window.dispatchEvent(
      new CustomEvent("apx:roby-prompt", {
        detail: {
          prompt:
            "Install the APX Android app on my phone over USB. Before running anything, tell me " +
            "what I have to do on the phone myself — the cable and the USB debugging switch. " +
            "Then run it and tell me which address it paired with and whether that address " +
            "survives unplugging. With these instructions: ",
        },
      }),
    );

  return (
    <Section title={t("android_app.title")} description={t("android_app.sub")}>
      <div className="mb-3 flex flex-wrap items-center gap-1.5">
        <ModeChip active={mode === "download"} onClick={() => setMode("download")} icon={Download}>
          {t("android_app.mode_download")}
        </ModeChip>
        <ModeChip active={mode === "pair"} onClick={() => setMode("pair")} icon={Link2}>
          {t("android_app.mode_pair")}
        </ModeChip>
      </div>

      {mode === "download" ? <DownloadMode onCopy={copy} /> : <PairAppMode onCopy={copy} />}

      <div className="mt-4 border-t border-border pt-3">
        <p className="text-xs text-muted-fg">{t("android_app.usb")}</p>
        <Button size="sm" className="mt-2" onClick={askPersona}>
          <Smartphone size={14} /> {t("android_app.ask", { persona })}
        </Button>
      </div>
    </Section>
  );
}

function ModeChip({
  active, onClick, icon: Icon, children,
}: {
  active: boolean;
  onClick: () => void;
  icon: typeof Download;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors",
        active
          ? "border-primary/50 bg-primary/12 text-primary"
          : "border-border text-muted-fg hover:bg-accent/60",
      )}
    >
      <Icon size={13} />
      {children}
    </button>
  );
}

function DownloadMode({ onCopy }: { onCopy: (t: string) => void }) {
  return (
    <div className="flex flex-wrap items-start gap-4">
      <Qr value={LINKS.androidApk} size={140} />
      <div className="min-w-0 flex-1 space-y-2">
        <p className="text-sm">{t("android_app.scan")}</p>
        {/* Said plainly rather than discovered by an iPhone owner who scanned
            it and got a file nothing opens. */}
        <p className="text-xs text-amber-600 dark:text-amber-400">{t("android_app.android_only")}</p>
        <code className="block truncate rounded-md border border-border bg-muted/30 px-2 py-1 font-mono text-xs">
          {LINKS.androidApk}
        </code>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" onClick={() => onCopy(LINKS.androidApk)}>
            <Download size={14} /> {t("android_app.copy")}
          </Button>
          <a
            href={LINKS.androidDocs}
            target="_blank"
            rel="noopener noreferrer"
            className={buttonVariants({ variant: "ghost", size: "sm" })}
          >
            {t("android_app.docs")}
          </a>
        </div>
      </div>
    </div>
  );
}

/**
 * A QR the installed app answers, not the browser.
 *
 * Minted on demand — a pairing code is a live credential with a five-minute
 * life, and one sitting on a settings screen nobody is looking at is a code
 * left on a desk.
 */
function PairAppMode({ onCopy }: { onCopy: (t: string) => void }) {
  const [link, setLink] = useState<string | null>(null);
  const [addr, setAddr] = useState<string>("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const mint = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const init = await Pair.init();
      // The same ranking the CLI uses: an https tailnet name first, then
      // anything that is not loopback. A phone cannot reach this machine's
      // 127.0.0.1, so that one is never worth encoding.
      const url =
        init.lan_urls.find((u) => u.startsWith("https://")) ||
        init.lan_urls.find((u) => !u.includes("127.0.0.1") && !u.includes("localhost")) ||
        init.lan_urls[0] ||
        "";
      setAddr(url);
      setLink(`apx://pair?url=${encodeURIComponent(url)}&pid=${init.pairing_id}`);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => { void mint(); }, [mint]);

  if (error) {
    return (
      <div className="space-y-2">
        <p className="text-sm text-destructive">{error}</p>
        <Button size="sm" onClick={() => void mint()}>{t("common.retry")}</Button>
      </div>
    );
  }
  if (!link || busy) {
    return <div className="flex items-center gap-2 py-6 text-sm text-muted-fg"><Spinner /> {t("common.loading")}</div>;
  }

  return (
    <div className="flex flex-wrap items-start gap-4">
      <Qr value={link} size={140} />
      <div className="min-w-0 flex-1 space-y-2">
        <p className="text-sm">{t("android_app.pair_scan")}</p>
        {/* Which address the app will KEEP, named rather than hidden inside a
            QR. Over a cable `apx android install` can ping the phone and find
            out whether it reaches the tailnet; a QR cannot ask anything, so the
            next best thing is saying what it carries. */}
        <p className="text-xs text-muted-fg">
          {t("android_app.pair_addr")} <code className="font-mono text-foreground">{addr}</code>
        </p>
        {/\.ts\.net|\/\/100\./.test(addr) && (
          <p className="text-xs text-amber-600 dark:text-amber-400">{t("android_app.pair_tailnet")}</p>
        )}
        <p className="text-xs text-muted-fg">{t("android_app.pair_note")}</p>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" onClick={() => onCopy(link)}>
            <Link2 size={14} /> {t("android_app.copy")}
          </Button>
          <Button size="sm" variant="ghost" onClick={() => void mint()}>
            {t("android_app.pair_new")}
          </Button>
        </div>
      </div>
    </div>
  );
}
