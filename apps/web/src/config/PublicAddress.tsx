import type { HookError, HookMode, WebhooksState } from "@apx/protocol";
import { Badge, Button, Icons, Input, SegmentedControl, SettingRow, Skeleton } from "@apx/ui";
import { useCallback, useEffect, useState } from "react";
import { client } from "../data/client.ts";
import { notify } from "../data/notices.ts";
import { type MessageKey, useT } from "../i18n/index.ts";
import { SubHead } from "./SectionHead.tsx";

const MODES: Array<{ id: HookMode; label: MessageKey; body: MessageKey }> = [
  { id: "off", label: "hooks.off", body: "hooks.offBody" },
  { id: "tailscale", label: "hooks.tailscale", body: "hooks.tailscaleBody" },
  { id: "ngrok", label: "hooks.ngrok", body: "hooks.ngrokBody" },
  { id: "custom", label: "hooks.custom", body: "hooks.customBody" },
];
const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));
/** What each reason the address is not up says; the missing or disconnected tool already has its hint above. */
const ERRORS: Record<HookError, MessageKey | undefined> = {
  tailscale_missing: undefined,
  tailscale_offline: undefined,
  ngrok_missing: undefined,
  funnel_failed: "hooks.err.funnel_failed",
  ngrok_timeout: "hooks.err.ngrok_timeout",
  ngrok_failed: "hooks.err.ngrok_failed",
  ngrok_stopped: "hooks.err.ngrok_stopped",
  failed: "hooks.err.failed",
};

/**
 * The public address a channel that delivers to a webhook (Teams, LINE) needs: how it is made (Tailscale Funnel, ngrok,
 * the owner's own URL) and this channel's address to paste into the platform.
 */
export function PublicAddress({ channelId }: { channelId: string }) {
  const t = useT();
  const [state, setState] = useState<WebhooksState>();
  const [busy, setBusy] = useState(false);
  const [own, setOwn] = useState("");
  const [domain, setDomain] = useState("");
  const load = useCallback(async () => {
    try {
      const next = await client.call("webhooks.get", {});
      setState(next);
      setDomain((d) => d || next.domain || "");
    } catch (e) {
      notify(t("hooks.failed", { error: errText(e) }));
    }
  }, [t]);
  useEffect(() => {
    void load();
    const timer = setInterval(() => void load(), 10_000);
    return () => clearInterval(timer);
  }, [load]);

  const apply = async (mode: HookMode) => {
    setBusy(true);
    try {
      setState(
        await client.call("webhooks.set", {
          mode,
          ...(mode === "custom" && own.trim() ? { url: own.trim() } : {}),
          ...(mode === "ngrok" && domain.trim() ? { domain: domain.trim() } : {}),
        }),
      );
    } catch (e) {
      notify(t("hooks.failed", { error: errText(e) }));
    } finally {
      setBusy(false);
    }
  };

  if (!state) return <Skeleton width="100%" height={120} />;
  const current = MODES.find((m) => m.id === state.mode) ?? MODES[0];
  const address = state.url ? `${state.url}/hooks/${channelId}` : undefined;
  const copy = () =>
    address &&
    void navigator.clipboard.writeText(address).then(
      () => notify(t("hooks.copied"), "info"),
      () => {},
    );
  return (
    <>
      <SubHead>{t("hooks.title")}</SubHead>
      <p className="config__lead">{t("hooks.lead")}</p>
      <SettingRow title={t("hooks.how")} description={current ? t(current.body) : undefined}>
        <SegmentedControl
          size="sm"
          label={t("hooks.how")}
          options={MODES.map((m) => ({ value: m.id, label: t(m.label) }))}
          value={state.mode}
          onValueChange={(v) => {
            const mode = v as HookMode;
            // The owner's own URL is applied once typed; the others at once.
            if (!busy && mode !== state.mode && mode !== "custom") void apply(mode);
            else if (mode === "custom") setState({ ...state, mode });
          }}
        />
      </SettingRow>
      {state.mode === "tailscale" && !state.tailscale.connected && (
        <p className="pform__hint">{t(state.tailscale.installed ? "hooks.tsDisconnected" : "hooks.tsMissing")}</p>
      )}
      {state.mode === "ngrok" && (
        <SettingRow title={t("hooks.domain")} description={t("hooks.domainHint")}>
          <div className="config__headactions">
            <Input
              aria-label={t("hooks.domain")}
              placeholder="acme.ngrok.app"
              value={domain}
              onChange={(e) => setDomain(e.currentTarget.value)}
            />
            <Button size="sm" variant="secondary" loading={busy} onClick={() => void apply("ngrok")}>
              {t("common.save")}
            </Button>
          </div>
        </SettingRow>
      )}
      {state.mode === "ngrok" && !state.ngrok.installed && <p className="pform__hint">{t("hooks.ngrokMissing")}</p>}
      {state.mode === "custom" && (
        <SettingRow title={t("hooks.ownUrl")} description={t("hooks.ownUrlHint", { port: state.port })}>
          <div className="config__headactions">
            <Input
              aria-label={t("hooks.ownUrl")}
              placeholder="https://hooks.example.com"
              value={own}
              onChange={(e) => setOwn(e.currentTarget.value)}
            />
            <Button
              size="sm"
              variant="secondary"
              disabled={!own.trim().startsWith("https://")}
              loading={busy}
              onClick={() => void apply("custom")}
            >
              {t("common.save")}
            </Button>
          </div>
        </SettingRow>
      )}
      {state.error && ERRORS[state.error] && (
        <div className="tgcard__error">
          {t(ERRORS[state.error] as MessageKey)}
          {state.error_detail && (
            <>
              {" "}
              <code>{t("hooks.errDetail", { detail: state.error_detail })}</code>
            </>
          )}
        </div>
      )}
      {state.mode !== "off" && (
        <SettingRow title={t("hooks.address")} description={t("hooks.addressHint")}>
          <div className="config__headactions">
            {address ? (
              <>
                <code className="devices__url">{address}</code>
                <Button size="sm" variant="secondary" leadingIcon={<Icons.Copy size={14} />} onClick={copy}>
                  {t("hooks.copy")}
                </Button>
              </>
            ) : (
              <Badge tone="neutral">{t("hooks.notUp")}</Badge>
            )}
          </div>
        </SettingRow>
      )}
      {state.url_may_change && address && (
        <div className="access__note" role="status">
          <Icons.TriangleAlert size={14} />
          <span>{t("hooks.mayChange")}</span>
        </div>
      )}
    </>
  );
}
