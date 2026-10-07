import { pairingLink } from "@apx/protocol/client";
import { Button, Dialog, EmptyState, Icons, Skeleton } from "@apx/ui";
import { useEffect, useState } from "react";
import { QrCode } from "../common/QrCode.tsx";
import { client } from "../data/client.ts";
import { useT } from "../i18n/index.ts";
import { go, useNav } from "./nav.ts";

type Pairing = { code: string; expires_at: string; urls: string[] };

/**
 * A QR the phone's camera opens in the APX app: it pairs the phone (once) and opens this chat. A phone already paired
 * with this core only opens the chat. The code is asked when the dialog opens, renewed when it runs out, voided on close.
 */
export function PhoneDialog() {
  const t = useT();
  const open = useNav((s) => s.phone);
  const thread = useNav((s) => s.threadId);
  const [pairing, setPairing] = useState<Pairing>();
  const [error, setError] = useState<string>();
  useEffect(() => {
    if (!open) return;
    let current: Pairing | undefined;
    let renew: ReturnType<typeof setTimeout> | undefined;
    let closed = false;
    const ask = async () => {
      try {
        const next = await client.call("devices.pair_start", {});
        if (closed) return void client.call("devices.pair_cancel", { code: next.code }).catch(() => undefined);
        current = next;
        setPairing(next);
        setError(undefined);
        renew = setTimeout(() => void ask(), Math.max(5_000, Date.parse(next.expires_at) - Date.now() - 5_000));
      } catch (e) {
        if (!closed) setError(e instanceof Error ? e.message : String(e));
      }
    };
    void ask();
    return () => {
      closed = true;
      clearTimeout(renew);
      if (current) void client.call("devices.pair_cancel", { code: current.code }).catch(() => undefined);
      setPairing(undefined);
    };
  }, [open]);
  return (
    <Dialog
      open={open}
      onOpenChange={go.phone}
      size="md"
      title={t("phone.open")}
      description={t("phone.description")}
      closeLabel={t("common.close")}
      footer={
        <Button variant="secondary" onClick={() => go.phone(false)}>
          {t("common.close")}
        </Button>
      }
    >
      <div className="phone">
        {error ? (
          <EmptyState variant="dashed" icon={<Icons.TriangleAlert />} title={t("phone.failed")}>
            {error}
          </EmptyState>
        ) : !pairing ? (
          <Skeleton width={260} height={260} />
        ) : pairing.urls.length ? (
          <QrCode value={pairingLink({ ...pairing, thread })} label={t("devices.scan")} />
        ) : (
          <EmptyState variant="dashed" icon={<Icons.WifiOff />} title={t("devices.localOnly")}>
            {t("devices.localOnlyBody")}
          </EmptyState>
        )}
        <p className="phone__hint">{t("phone.hint")}</p>
        {pairing?.urls.length ? (
          <p className="phone__hint">
            {t("devices.code")} <code className="devices__code">{pairing.code}</code>
          </p>
        ) : null}
      </div>
    </Dialog>
  );
}
