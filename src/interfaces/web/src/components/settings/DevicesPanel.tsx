import { useState } from "react";
import { MonitorSmartphone, QrCode } from "lucide-react";
import { Section } from "../Section";
import { Badge, Button, Empty, Field, Input, Loading } from "../ui";
import { useToast } from "../Toast";
import { useDevices } from "../../hooks/useDevices";
import { Pair, getToken, setToken } from "../../lib/api";
import { STORAGE } from "../../constants";
import { PairDeviceDialog } from "./PairDeviceDialog";
import { AccessPanel } from "./AccessPanel";
import { AndroidAppPanel } from "./AndroidAppPanel";
import { ConfirmDialog } from "../common/ConfirmDialog";
import { t } from "../../i18n";

export function DevicesPanel() {
  const toast = useToast();
  const { clients, isLoading, mutate } = useDevices();
  const [pairOpen, setPairOpen] = useState(false);
  const [draftToken, setDraftToken] = useState("");
  const [confirm, setConfirm] = useState<{ id: string } | null>(null);
  const [kind, setKind] = useState<string>("all");

  const doRevoke = async () => {
    if (!confirm) return;
    try {
      await Pair.revoke(confirm.id);
      toast.success(t("settings.devices_revoke_success"));
      mutate();
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  const saveToken = () => {
    const v = draftToken.trim();
    if (!v) return;
    setToken(v);
    try { localStorage.setItem(STORAGE.token, v); } catch { /* quota */ }
    setDraftToken("");
    toast.success(t("settings.token_saved"));
  };

  // Newest first. The list is append-only and grows for years; the device you
  // are looking for right after pairing it was at the bottom, under phones
  // last seen in August.
  const sorted = [...clients].sort((a, b) => {
    const at = Date.parse(a.last_seen || a.created_at || "") || 0;
    const bt = Date.parse(b.last_seen || b.created_at || "") || 0;
    return bt - at;
  });
  const kinds = [...new Set(sorted.map((c) => c.kind || "device"))].sort();
  const shown = kind === "all" ? sorted : sorted.filter((c) => (c.kind || "device") === kind);

  return (
    // Two columns where there is room. The left one is "how a device gets
    // here", the right one is "which ones did" — reading order, not a grid for
    // its own sake, and one column below xl because none of these panels
    // survive being half a phone wide.
    <div className="grid gap-6 xl:grid-cols-2 xl:items-start">
      <div className="space-y-6">
        <AccessPanel />
        {/* Get the app, give it an address, pair it — in that order, which is
            the order the phone needs them in. */}
        <AndroidAppPanel />
      </div>

      <div className="space-y-6">
      <Section
        title={t("settings.devices")}
        description={t("settings.devices_sub")}
        action={
          <Button size="sm" variant="primary" onClick={() => setPairOpen(true)}>
            <QrCode size={14} /> {t("settings.devices_pair_btn")}
          </Button>
        }
      >
        {kinds.length > 1 && (
          <div className="mb-3 flex flex-wrap gap-1.5">
            <KindChip active={kind === "all"} onClick={() => setKind("all")}>
              {t("settings.devices_kind_all")} {sorted.length}
            </KindChip>
            {kinds.map((k) => (
              <KindChip key={k} active={kind === k} onClick={() => setKind(k)}>
                {k} {sorted.filter((c) => (c.kind || "device") === k).length}
              </KindChip>
            ))}
          </div>
        )}
        {isLoading && <Loading />}
        {!isLoading && shown.length === 0 && (
          <Empty icon={MonitorSmartphone}>{t("settings.devices_empty")}</Empty>
        )}
        {shown.length > 0 && (
          <ul className="space-y-2 text-sm">
            {shown.map((c) => (
              <li key={c.id} className="flex items-center gap-3 rounded-md border border-border bg-muted/30 px-3 py-2">
                <span className="font-medium">{c.label || c.id}</span>
                <Badge tone={c.kind === "web" ? "info" : c.kind === "deck" ? "success" : "muted"}>{c.kind}</Badge>
                {/* Only the app reports this, and only since it started to —
                    an older phone shows nothing rather than a wrong number. */}
                {c.app_version && <span className="font-mono text-xs text-muted-fg">v{c.app_version}</span>}
                <span className="font-mono text-xs text-muted-fg">…{c.token_suffix}</span>
                <span className="ml-auto text-xs text-muted-fg">
                  {t("settings.devices_last_seen")} {c.last_seen ? new Date(c.last_seen).toLocaleString() : t("settings.devices_never")}
                </span>
                <Button size="sm" variant="destructive" onClick={() => setConfirm({ id: c.id })}>{t("settings.devices_revoke")}</Button>
              </li>
            ))}
          </ul>
        )}

        <PairDeviceDialog open={pairOpen} onClose={() => setPairOpen(false)} onPaired={() => mutate()} />
      </Section>

      {/* Session token lives next to Devices: it's the bearer this very web
          client authenticates with — a fallback when auto-load didn't work. */}
      <Section title={t("settings.token")} description={t("settings.token_sub")}>
        <Field label={t("settings_ui.bearer_label")}>
          <Input
            type="password"
            placeholder={getToken() ? t("settings.token_active") : t("settings.token_paste")}
            value={draftToken}
            onChange={(e) => setDraftToken(e.target.value)}
            className="font-mono"
            onKeyDown={(e) => { if (e.key === "Enter") saveToken(); }}
          />
        </Field>
        <div className="mt-2">
          <Button variant="primary" onClick={saveToken}>{t("common.save")}</Button>
        </div>
      </Section>

      </div>

      <ConfirmDialog
        open={!!confirm}
        onClose={() => setConfirm(null)}
        onConfirm={doRevoke}
        title={t("settings.devices_revoke_confirm", { id: confirm?.id ?? "" })}
        confirmLabel={t("settings.devices_revoke")}
        testId="device-revoke-confirm"
      />
    </div>
  );
}

/** One filter chip — same shape the phone's list uses. */
function KindChip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={
        "shrink-0 whitespace-nowrap rounded-full border px-3 py-1 text-xs font-medium transition-colors " +
        (active
          ? "border-primary/50 bg-primary/12 text-primary"
          : "border-border text-muted-fg hover:bg-accent/60")
      }
    >
      {children}
    </button>
  );
}
