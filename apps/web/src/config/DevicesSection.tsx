import type { Device } from "@apx/protocol";
import { pairingLink } from "@apx/protocol/client";
import { Badge, Button, EmptyState, IconButton, Icons } from "@apx/ui";
import { useCallback, useEffect, useState } from "react";
import { QrCode } from "../common/QrCode.tsx";
import { client } from "../data/client.ts";
import { notify } from "../data/notices.ts";
import { useT } from "../i18n/index.ts";
import { SectionHead, SubHead } from "./SectionHead.tsx";

type Pairing = { code: string; expires_at: string; urls: string[] };

/**
 * Your devices (a phone, another computer): pair one by scanning a QR with the APX app, which then talks to this core
 * with a token of its own; remove one and only that one stops.
 */
export function DevicesSection() {
  const t = useT();
  const [devices, setDevices] = useState<Device[]>();
  const [pairing, setPairing] = useState<Pairing>();
  const fail = useCallback(
    (e: unknown) => notify(t("error.devices", { error: e instanceof Error ? e.message : String(e) })),
    [t],
  );
  const load = useCallback(async () => {
    try {
      setDevices((await client.call("devices.list", {})).devices);
    } catch (e) {
      fail(e);
    }
  }, [fail]);
  useEffect(() => {
    void load();
  }, [load]);
  // While a code waits, the list is read again now and then: the new device shows up once it paired.
  useEffect(() => {
    if (!pairing) return;
    const id = setInterval(() => void load(), 3000);
    const done = setTimeout(() => setPairing(undefined), Date.parse(pairing.expires_at) - Date.now());
    return () => {
      clearInterval(id);
      clearTimeout(done);
    };
  }, [pairing, load]);

  const start = async () => {
    try {
      setPairing(await client.call("devices.pair_start", {}));
    } catch (e) {
      fail(e);
    }
  };
  const remove = async (id: string) => {
    try {
      await client.call("devices.revoke", { id });
      await load();
    } catch (e) {
      fail(e);
    }
  };

  return (
    <>
      <SectionHead
        title={t("config.devices")}
        lead={t("devices.lead")}
        actions={
          <Button
            size="sm"
            variant="secondary"
            leadingIcon={<Icons.Smartphone size={14} />}
            onClick={() => void start()}
          >
            {t("devices.pair")}
          </Button>
        }
      />
      {pairing && (
        <div className="waqr">
          {pairing.urls.length ? (
            <QrCode value={pairingLink(pairing)} label={t("devices.scan")} />
          ) : (
            <EmptyState variant="dashed" icon={<Icons.WifiOff />} title={t("devices.localOnly")}>
              {t("devices.localOnlyBody")}
            </EmptyState>
          )}
          <div className="waqr__text">
            <p>{t("devices.scanHint")}</p>
            <p>
              {t("devices.code")} <code className="devices__code">{pairing.code}</code>
            </p>
            {pairing.urls.map((u) => (
              <code key={u} className="devices__url">
                {u}
              </code>
            ))}
          </div>
        </div>
      )}
      <SubHead>{t("devices.paired")}</SubHead>
      {devices?.length === 0 && (
        <EmptyState variant="dashed" size="sm" icon={<Icons.Smartphone />}>
          {t("devices.none")}
        </EmptyState>
      )}
      {devices?.map((d) => (
        <div key={d.id} className="tgtoken">
          <span className="res__name">{d.name}</span>
          <Badge>{t(`devices.platform.${d.platform}`)}</Badge>
          {d.last_seen_at && (
            <span className="pform__hint">
              {t("devices.lastSeen", { when: d.last_seen_at.slice(0, 16).replace("T", " ") })}
            </span>
          )}
          <IconButton
            size="sm"
            label={t("devices.remove", { name: d.name })}
            icon={<Icons.Trash2 size={14} />}
            onClick={() => void remove(d.id)}
          />
        </div>
      ))}
    </>
  );
}
