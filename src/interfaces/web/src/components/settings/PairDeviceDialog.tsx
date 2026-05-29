import { useCallback, useEffect, useRef, useState } from "react";
import { Copy } from "lucide-react";
import { Dialog, Button, Spinner } from "../ui";
import { Qr } from "../common/Qr";
import { useToast } from "../Toast";
import { Pair, HttpError } from "../../lib/api";
import type { PairInit } from "../../types/daemon";
import { t } from "../../i18n";

function pickLanUrl(urls: string[]): string {
  return urls.find((u) => !u.includes("127.0.0.1") && !u.includes("localhost"))
    || urls[0]
    || window.location.origin;
}

export function PairDeviceDialog({
  open,
  onClose,
  onPaired,
}: {
  open: boolean;
  onClose: () => void;
  onPaired: () => void;
}) {
  const toast = useToast();
  const [init, setInit] = useState<PairInit | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [secsLeft, setSecsLeft] = useState(0);
  const [done, setDone] = useState(false);
  const pollRef = useRef<number | null>(null);

  const start = useCallback(async () => {
    setInit(null); setError(null); setDone(false);
    try {
      const res = await Pair.init();
      setInit(res);
      setSecsLeft(Math.round((res.ttl_ms || 90_000) / 1000));
    } catch (e) {
      if (e instanceof HttpError && e.status === 403) setError(t("settings.devices_pair_localhost_only"));
      else setError((e as Error).message);
    }
  }, []);

  // (Re)start when the dialog opens; tear down on close.
  useEffect(() => {
    if (open) void start();
    else { setInit(null); setError(null); setDone(false); }
  }, [open, start]);

  // Countdown.
  useEffect(() => {
    if (!init || done) return;
    if (secsLeft <= 0) return;
    const id = window.setTimeout(() => setSecsLeft((s) => s - 1), 1000);
    return () => window.clearTimeout(id);
  }, [init, secsLeft, done]);

  // Poll for confirmation.
  useEffect(() => {
    if (!open || !init || done) return;
    let alive = true;
    const tick = async () => {
      try {
        const s = await Pair.status(init.pairing_id);
        if (!alive) return;
        if (s.status === "confirmed") {
          setDone(true);
          toast.success(t("settings.devices_pair_done"));
          onPaired();
          window.setTimeout(() => { if (alive) onClose(); }, 900);
          return;
        }
        if (s.status === "expired" || s.status === "unknown") { setSecsLeft(0); return; }
      } catch { /* transient */ }
      pollRef.current = window.setTimeout(tick, 1500);
    };
    pollRef.current = window.setTimeout(tick, 1500);
    return () => { alive = false; if (pollRef.current) window.clearTimeout(pollRef.current); };
  }, [open, init, done, onClose, onPaired, toast]);

  const expired = !!init && !done && secsLeft <= 0;
  const lanUrl = init ? pickLanUrl(init.lan_urls) : "";
  const scanUrl = init ? `${lanUrl}/#pair=${init.pairing_id}` : "";

  const copy = async (text: string, msg: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast.success(msg);
    } catch {
      toast.error(text);
    }
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={t("settings.devices_pair_title")}
      description={t("settings.devices_pair_desc")}
      footer={<Button variant="secondary" onClick={onClose}>{t("common.close")}</Button>}
    >
      {error && (
        <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>
      )}

      {!error && !init && (
        <div className="flex items-center gap-2 py-8 text-sm text-muted-fg">
          <Spinner /> {t("common.loading")}
        </div>
      )}

      {!error && init && (
        <div className="flex flex-col items-center gap-4">
          <div className={expired ? "opacity-40" : ""}>
            <Qr value={scanUrl} size={196} />
          </div>

          {done ? (
            <p className="text-sm font-medium text-emerald-500">{t("settings.devices_pair_done")}</p>
          ) : expired ? (
            <div className="flex flex-col items-center gap-2">
              <p className="text-sm text-muted-fg">{t("settings.devices_pair_expired")}</p>
              <Button variant="primary" onClick={() => void start()}>{t("settings.devices_pair_regen")}</Button>
            </div>
          ) : (
            <>
              <p className="text-center text-xs text-muted-fg">{t("settings.devices_pair_scan")}</p>
              <div className="flex items-center gap-2 text-xs text-muted-fg">
                <Spinner size={12} />
                <span>{t("settings.devices_pair_waiting")}</span>
                <span className="tabular-nums">· {t("settings.devices_pair_expires", { s: secsLeft })}</span>
              </div>

              <div className="w-full space-y-3 border-t border-border pt-3">
                <div className="space-y-1">
                  <p className="text-xs text-muted-fg">{t("settings.devices_pair_link")}</p>
                  <div className="flex items-stretch gap-2">
                    <code className="min-w-0 flex-1 break-all rounded-md bg-muted px-3 py-2 text-xs">
                      {scanUrl}
                    </code>
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => copy(scanUrl, t("settings.devices_pair_copied"))}
                      title={t("settings.devices_pair_copy")}
                    >
                      <Copy size={14} />
                    </Button>
                  </div>
                </div>

                <div className="space-y-1">
                  <p className="text-xs text-muted-fg">{t("settings.devices_pair_code")}</p>
                  <div className="flex items-stretch gap-2">
                    <code className="min-w-0 flex-1 break-all rounded-md bg-muted px-3 py-2 text-center text-sm">
                      {init.pairing_id}
                    </code>
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => copy(init.pairing_id, t("settings.devices_pair_copied_code"))}
                      title={t("settings.devices_pair_copy")}
                    >
                      <Copy size={14} />
                    </Button>
                  </div>
                </div>
              </div>
            </>
          )}
        </div>
      )}
    </Dialog>
  );
}
