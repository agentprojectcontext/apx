import { useState } from "react";
import { QrCode } from "lucide-react";
import { Section } from "../Section";
import { Badge, Button, Empty, Loading } from "../ui";
import { useToast } from "../Toast";
import { useDevices } from "../../hooks/useDevices";
import { Pair } from "../../lib/api";
import { PairDeviceDialog } from "./PairDeviceDialog";
import { t } from "../../i18n";

export function DevicesPanel() {
  const toast = useToast();
  const { clients, isLoading, mutate } = useDevices();
  const [pairOpen, setPairOpen] = useState(false);

  const revoke = async (id: string) => {
    if (!confirm(t("settings.devices_revoke_confirm", { id }))) return;
    try {
      await Pair.revoke(id);
      toast.success(t("settings.devices_revoke_success"));
      mutate();
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  return (
    <Section
      title={t("settings.devices")}
      description={t("settings.devices_sub")}
      action={
        <Button size="sm" variant="primary" onClick={() => setPairOpen(true)}>
          <QrCode size={14} /> {t("settings.devices_pair_btn")}
        </Button>
      }
    >
      {isLoading && <Loading />}
      {!isLoading && clients.length === 0 && (
        <Empty>{t("settings.devices_empty")}</Empty>
      )}
      {clients.length > 0 && (
        <ul className="space-y-2 text-sm">
          {clients.map((c) => (
            <li key={c.id} className="flex items-center gap-3 rounded-md border border-border bg-muted/30 px-3 py-2">
              <span className="font-medium">{c.label || c.id}</span>
              <Badge tone={c.kind === "web" ? "info" : c.kind === "deck" ? "success" : "muted"}>{c.kind}</Badge>
              <span className="font-mono text-xs text-muted-fg">…{c.token_suffix}</span>
              <span className="ml-auto text-xs text-muted-fg">
                {t("settings.devices_last_seen")} {c.last_seen ? new Date(c.last_seen).toLocaleString() : t("settings.devices_never")}
              </span>
              <Button size="sm" variant="destructive" onClick={() => revoke(c.id)}>{t("settings.devices_revoke")}</Button>
            </li>
          ))}
        </ul>
      )}

      <PairDeviceDialog open={pairOpen} onClose={() => setPairOpen(false)} onPaired={() => mutate()} />
    </Section>
  );
}
