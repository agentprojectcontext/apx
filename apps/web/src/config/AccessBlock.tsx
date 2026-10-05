import type { AccessState, Result } from "@apx/protocol";
import { Badge, Button, Icons, SegmentedControl, SettingRow } from "@apx/ui";
import { useCallback, useEffect, useState } from "react";
import { client } from "../data/client.ts";
import { notify } from "../data/notices.ts";
import { type MessageKey, useT } from "../i18n/index.ts";
import { SubHead } from "./SectionHead.tsx";

type Mode = AccessState["mode"];
const MODES: Array<{ id: Mode; label: MessageKey; body: MessageKey }> = [
  { id: "local", label: "access.local", body: "access.localBody" },
  { id: "lan", label: "access.lan", body: "access.lanBody" },
  { id: "tailscale", label: "access.tailscale", body: "access.tailscaleBody" },
];

/** Waits for the core to answer again after it restarted, then loads the panel anew (with the core's new token). */
async function reloadWhenBack(): Promise<void> {
  await new Promise((r) => setTimeout(r, 1200));
  for (let i = 0; i < 60; i++) {
    try {
      if ((await fetch("/health", { cache: "no-store" })).ok) break;
    } catch {}
    await new Promise((r) => setTimeout(r, 500));
  }
  window.location.reload();
}

/** Who may reach this APX: this computer only, the local network, or the owner's tailnet. */
export function AccessBlock() {
  const t = useT();
  const [state, setState] = useState<AccessState>();
  const [busy, setBusy] = useState(false);
  const [restarting, setRestarting] = useState(false);
  const load = useCallback(async () => {
    try {
      setState(await client.call("access.get", {}));
    } catch (e) {
      notify(t("access.failed", { error: e instanceof Error ? e.message : String(e) }));
    }
  }, [t]);
  useEffect(() => {
    void load();
  }, [load]);

  const choose = async (mode: Mode) => {
    setBusy(true);
    try {
      const r: Result<"access.set"> = await client.call("access.set", { mode });
      setState(r);
      if (r.restarting) {
        setRestarting(true);
        await reloadWhenBack();
      }
    } catch (e) {
      notify(t("access.failed", { error: e instanceof Error ? e.message : String(e) }));
    } finally {
      setBusy(false);
    }
  };

  if (!state) return null;
  const current = MODES.find((m) => m.id === state.saved) ?? MODES[0];
  const ts = state.tailscale;
  return (
    <>
      <SubHead>{t("access.title")}</SubHead>
      <SettingRow title={t("access.who")} description={current ? t(current.body) : undefined}>
        <SegmentedControl
          options={MODES.map((m) => ({ value: m.id, label: t(m.label) }))}
          value={state.saved}
          onValueChange={(v) => {
            if (!busy && !restarting && v !== state.saved) void choose(v as Mode);
          }}
        />
      </SettingRow>
      <SettingRow
        title="Tailscale"
        description={!ts.installed ? t("access.tsMissing") : ts.connected ? (ts.url ?? "") : t("access.tsDisconnected")}
      >
        <Badge tone={ts.connected ? "brand" : "neutral"}>
          {t(!ts.installed ? "access.tsOff" : ts.connected ? "access.tsOn" : "access.tsDown")}
        </Badge>
      </SettingRow>
      {state.urls.length > 0 && (
        <SettingRow title={t("access.reach")} description={t("access.reachBody")}>
          <div className="access__urls">
            {state.urls.map((u) => (
              <code key={u} className="devices__url">
                {u}
              </code>
            ))}
          </div>
        </SettingRow>
      )}
      {(restarting || state.restart_needed) && (
        <div className="access__note" role="status">
          <Icons.RefreshCw size={14} />
          <span>{t(restarting ? "access.restarting" : "access.restartNeeded")}</span>
          {!restarting && (
            <Button size="sm" variant="secondary" onClick={() => void load()}>
              {t("access.check")}
            </Button>
          )}
        </div>
      )}
    </>
  );
}
