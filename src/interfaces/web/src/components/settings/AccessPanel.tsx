import { useCallback, useEffect, useState } from "react";
import useSWR from "swr";
import {
  Check,
  Copy,
  Globe,
  Laptop,
  QrCode,
  ShieldAlert,
  Smartphone,
  Wifi,
} from "lucide-react";
import { Section } from "../Section";
import { Badge, Button, Loading, Spinner } from "../ui";
import { Qr } from "../common/Qr";
import { useToast } from "../Toast";
import { Net, type Endpoint } from "../../lib/api";
import { apiBase, isSecure } from "../../lib/net";
import { installStance, onInstallStateChange, promptInstall } from "../../lib/pwa";
import { cn } from "../../lib/cn";
import { t } from "../../i18n";

/**
 * Where this daemon can be reached from, and how to turn one of those
 * addresses into an app on a phone.
 *
 * The three things on this panel are one story. An installed app launches at
 * the address it was installed from — so which address you install from is the
 * decision, not a detail. Only an https:// one can be installed at all (and
 * only there does the microphone work), and `tailscale serve` is the one way
 * to a real certificate that does not involve buying a domain.
 */
export function AccessPanel() {
  const toast = useToast();
  const { data, isLoading, mutate } = useSWR("net-endpoints", () => Net.endpoints(), {
    revalidateOnFocus: false,
  });
  const [busy, setBusy] = useState(false);
  const [showQr, setShowQr] = useState<string | null>(null);
  const [, bump] = useState(0);

  // The install prompt arrives whenever Chrome decides it does — after the
  // service worker settles, which is usually after this panel has painted.
  useEffect(() => onInstallStateChange(() => bump((n) => n + 1)), []);

  const copy = useCallback(
    async (text: string) => {
      try {
        await navigator.clipboard.writeText(text);
        toast.success(t("access.copied"));
      } catch {
        // No clipboard without a secure context either — show it so it can be
        // selected by hand rather than failing with nothing on screen.
        toast.info(text);
      }
    },
    [toast],
  );

  const toggleServe = async (on: boolean) => {
    setBusy(true);
    try {
      const out = on ? await Net.serve() : await Net.unserve();
      if (out.ok) toast.success(on ? t("access.serve_on") : t("access.serve_off"));
      else toast.error(out.error || t("access.serve_failed"));
      await mutate();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const stance = installStance();
  const ts = data?.tailscale;

  return (
    <div className="space-y-6">
      <Section title={t("access.install_title")} description={t("access.install_sub")}>
        {stance.kind === "installed" && (
          <p className="flex items-center gap-2 text-sm text-muted-fg">
            <Check size={14} className="text-emerald-500" /> {t("access.install_done")}
          </p>
        )}
        {stance.kind === "prompt" && (
          <Button
            variant="primary"
            onClick={async () => {
              if (await promptInstall()) toast.success(t("access.install_done"));
            }}
          >
            <Smartphone size={14} /> {t("access.install_now")}
          </Button>
        )}
        {stance.kind === "ios" && (
          <p className="text-sm text-muted-fg">{t("access.install_ios")}</p>
        )}
        {stance.kind === "insecure" && (
          <p className="flex items-start gap-2 rounded-md bg-amber-500/10 px-3 py-2 text-sm text-amber-700 dark:text-amber-300">
            <ShieldAlert size={14} className="mt-0.5 shrink-0" />
            <span>{t("access.install_insecure")}</span>
          </p>
        )}
        {stance.kind === "unsupported" && (
          <p className="text-sm text-muted-fg">{t("access.install_unsupported")}</p>
        )}
      </Section>

      <Section title={t("access.addresses_title")} description={t("access.addresses_sub")}>
        {isLoading && <Loading />}
        {data && (
          <ul className="space-y-2">
            {data.endpoints.map((e) => (
              <li key={e.url} className="rounded-md border border-border bg-muted/30 px-3 py-2">
                <div className="flex flex-wrap items-center gap-2 text-sm">
                  <EndpointIcon kind={e.kind} />
                  <span className="min-w-0 flex-1 truncate font-mono text-xs">{e.url}</span>
                  {/* "secure", not "HTTPS": loopback qualifies as a secure
                      context without a certificate, and this badge is about
                      what the browser will ALLOW (installing, the microphone,
                      the clipboard), not about the scheme. */}
                  {e.secure && <Badge tone="success">{t("access.secure")}</Badge>}
                  <Badge tone="muted">{kindLabel(e.kind)}</Badge>
                  {new URL(e.url).origin === window.location.origin && !apiBase() && (
                    <Badge tone="info">{t("access.here")}</Badge>
                  )}
                  <Button size="sm" variant="ghost" onClick={() => void copy(e.url)} aria-label={t("access.copy")}>
                    <Copy size={13} />
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => setShowQr(showQr === e.url ? null : e.url)}
                    aria-label={t("access.qr")}
                  >
                    <QrCode size={13} />
                  </Button>
                </div>
                {showQr === e.url && (
                  <div className="mt-3 flex flex-col items-center gap-2">
                    <Qr value={e.url} size={168} />
                    <p className="text-center text-xs text-muted-fg">{t("access.qr_hint")}</p>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
        {data && !data.shared && (
          <p className="mt-3 text-xs text-muted-fg">{t("access.local_only")}</p>
        )}
      </Section>

      <Section title={t("access.tailscale_title")} description={t("access.tailscale_sub")}>
        {!ts?.installed && <p className="text-sm text-muted-fg">{t("access.ts_absent")}</p>}
        {ts?.installed && !ts.running && (
          <p className="text-sm text-muted-fg">
            {t("access.ts_stopped", { state: ts.state || "?" })}
          </p>
        )}
        {ts?.running && (
          <div className="space-y-3">
            <p className="flex flex-wrap items-center gap-2 text-sm">
              <Badge tone="success">{t("access.ts_running")}</Badge>
              <span className="font-mono text-xs text-muted-fg">{ts.dnsName || ts.ipv4}</span>
            </p>
            {ts.serving && ts.serve_url ? (
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-mono text-xs">{ts.serve_url}</span>
                <Button variant="secondary" size="sm" disabled={busy} onClick={() => void toggleServe(false)}>
                  {busy ? <Spinner size={12} /> : null} {t("access.serve_stop")}
                </Button>
              </div>
            ) : (
              <Button variant="primary" size="sm" disabled={busy} onClick={() => void toggleServe(true)}>
                {busy ? <Spinner size={12} /> : <Globe size={14} />} {t("access.serve_start")}
              </Button>
            )}
            {ts.serve_error && <p className="text-xs text-destructive">{ts.serve_error}</p>}
          </div>
        )}
        {!isSecure() && (
          <p className="mt-3 text-xs text-muted-fg">{t("access.why_https")}</p>
        )}
      </Section>
    </div>
  );
}

function EndpointIcon({ kind }: { kind: Endpoint["kind"] }) {
  const Icon = kind === "loopback" ? Laptop : kind === "lan" ? Wifi : Globe;
  return (
    <Icon
      size={14}
      className={cn("shrink-0", kind.startsWith("tailscale") ? "text-primary" : "text-muted-fg")}
    />
  );
}

function kindLabel(kind: Endpoint["kind"]): string {
  if (kind === "tailscale-https") return t("access.kind_ts_https");
  if (kind === "tailscale") return t("access.kind_ts");
  if (kind === "lan") return t("access.kind_lan");
  return t("access.kind_local");
}
