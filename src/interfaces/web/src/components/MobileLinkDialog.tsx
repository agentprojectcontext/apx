import { useCallback, useEffect, useRef, useState } from "react";
import { Copy, ShieldAlert } from "lucide-react";
import { Dialog, Button, Spinner } from "./ui";
import { Qr } from "./common/Qr";
import { useToast } from "./Toast";
import { Net, Pair, HttpError } from "../lib/api";
import type { Endpoint } from "../lib/api/net";
import { t } from "../i18n";
import { toneText } from "../lib/tone";

/**
 * Getting the phone surface ONTO a phone.
 *
 * `/mobile` is a URL like any other, which means the honest answer to "how do I
 * open this on my phone" was "type a LAN address by hand". The QR here carries
 * the whole thing in one scan: the best address this daemon has, the /mobile
 * path, and — when the panel is running on the machine itself, which is the
 * only place allowed to mint one — a pairing nonce, so the phone lands already
 * authenticated instead of on a "pair this device" screen.
 *
 * Best address means the https:// one when there is a tailnet certificate. Not
 * a preference: the origin a phone arrives at is the origin its installed app
 * launches at forever, and only a secure one can install as an app, record a
 * voice note, or reach the clipboard.
 */
export function MobileLinkDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const toast = useToast();
  const [endpoint, setEndpoint] = useState<Endpoint | null>(null);
  const [pairingId, setPairingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [paired, setPaired] = useState(false);
  const pollRef = useRef<number | null>(null);

  const start = useCallback(async () => {
    setError(null);
    setPaired(false);
    setPairingId(null);
    try {
      const net = await Net.endpoints();
      // The daemon already ranks them by how long the address keeps working;
      // skip loopback, which is the one address a phone can never reach.
      const reachable = net.endpoints.filter((e) => e.kind !== "loopback");
      setEndpoint(reachable[0] || net.endpoints[0] || null);
    } catch (e) {
      setError((e as Error).message);
      return;
    }
    try {
      const init = await Pair.init();
      setPairingId(init.pairing_id);
    } catch (e) {
      // 403 = this panel is not on the daemon's machine, so it cannot mint a
      // nonce. The link still works; the phone pairs on arrival.
      if (!(e instanceof HttpError && e.status === 403)) {
        setError((e as Error).message);
      }
    }
  }, []);

  useEffect(() => {
    if (open) void start();
    else {
      setEndpoint(null);
      setPairingId(null);
      setError(null);
      setPaired(false);
    }
  }, [open, start]);

  // Say when the phone actually arrives — otherwise the only feedback for a
  // successful scan is on the other device, in your other hand.
  useEffect(() => {
    if (!open || !pairingId || paired) return;
    let alive = true;
    const tick = async () => {
      try {
        const s = await Pair.status(pairingId);
        if (!alive) return;
        if (s.status === "confirmed") {
          setPaired(true);
          return;
        }
        if (s.status === "expired" || s.status === "unknown") return;
      } catch {
        /* transient */
      }
      pollRef.current = window.setTimeout(tick, 1500);
    };
    pollRef.current = window.setTimeout(tick, 1500);
    return () => {
      alive = false;
      if (pollRef.current) window.clearTimeout(pollRef.current);
    };
  }, [open, pairingId, paired]);

  const base = endpoint?.url || window.location.origin;
  const link = `${base}/mobile`;
  // The nonce rides in the FRAGMENT: it never reaches a server, never lands in
  // a Referer header, and never shows up in a proxy log.
  const scanUrl = pairingId ? `${link}#pair=${pairingId}` : link;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(scanUrl);
      toast.success(t("access.copied"));
    } catch {
      toast.info(scanUrl);
    }
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={t("mobile_link.title")}
      description={t("mobile_link.desc")}
      footer={<Button variant="secondary" onClick={onClose}>{t("common.close")}</Button>}
    >
      {error && <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>}

      {!error && !endpoint && (
        <div className="flex items-center gap-2 py-8 text-sm text-muted-fg">
          <Spinner /> {t("common.loading")}
        </div>
      )}

      {!error && endpoint && (
        <div className="flex flex-col items-center gap-3">
          <Qr value={scanUrl} size={196} />

          {paired ? (
            <p className={`text-sm font-medium ${toneText.emerald}`}>{t("mobile_link.paired")}</p>
          ) : (
            <p className="text-center text-xs text-muted-fg">
              {pairingId ? t("mobile_link.scan_paired") : t("mobile_link.scan_plain")}
            </p>
          )}

          <div className="flex w-full items-center gap-2 rounded-md border border-border bg-muted/30 px-2 py-1.5">
            <span className="min-w-0 flex-1 truncate font-mono text-[11px]">{link}</span>
            <Button size="sm" variant="ghost" onClick={() => void copy()} aria-label={t("access.copy")}>
              <Copy size={13} />
            </Button>
          </div>

          {!endpoint.secure && (
            <p className="flex items-start gap-2 rounded-md bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-300">
              <ShieldAlert size={13} className="mt-0.5 shrink-0" />
              <span>{t("mobile_link.insecure")}</span>
            </p>
          )}
        </div>
      )}
    </Dialog>
  );
}
