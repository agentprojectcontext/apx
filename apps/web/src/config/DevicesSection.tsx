import type { Device } from "@apx/protocol";
import { pairingLink } from "@apx/protocol/client";
import { Badge, Button, EmptyState, IconButton, Icons, Input, Skeleton } from "@apx/ui";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { QrCode } from "../common/QrCode.tsx";
import { client } from "../data/client.ts";
import { notify } from "../data/notices.ts";
import { useT } from "../i18n/index.ts";
import { go } from "../shell/nav.ts";
import { AccessBlock } from "./AccessBlock.tsx";
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
  const [busy, setBusy] = useState(false);
  const fail = useCallback(
    (e: unknown) => notify(t("error.devices", { error: e instanceof Error ? e.message : String(e) })),
    [t],
  );
  /** The devices there were when the code was shown: one more means the code was used. */
  const known = useRef<Set<string>>(new Set());
  const load = useCallback(async () => {
    try {
      const list = (await client.call("devices.list", {})).devices;
      setDevices(list);
      return list;
    } catch (e) {
      fail(e);
      return undefined;
    }
  }, [fail]);
  useEffect(() => {
    void load();
  }, [load]);
  // While a code waits, the list is read again now and then: once the new device shows up, the code is done.
  useEffect(() => {
    if (!pairing) return;
    const id = setInterval(async () => {
      const added = (await load())?.find((d) => !known.current.has(d.id));
      if (!added) return;
      setPairing(undefined);
      notify(t("devices.pairedOk", { name: added.name }), "info");
    }, 3000);
    const done = setTimeout(() => setPairing(undefined), Date.parse(pairing.expires_at) - Date.now());
    return () => {
      clearInterval(id);
      clearTimeout(done);
    };
  }, [pairing, load, t]);

  const start = async () => {
    if (busy || pairing) return;
    setBusy(true);
    try {
      known.current = new Set(((await load()) ?? devices ?? []).map((d) => d.id));
      setPairing(await client.call("devices.pair_start", {}));
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
    }
  };
  const cancel = async () => {
    if (!pairing || busy) return;
    setBusy(true);
    try {
      await client.call("devices.pair_cancel", { code: pairing.code });
      setPairing(undefined);
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
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
      <SectionHead title={t("config.devices")} lead={t("devices.lead")} />
      <div>
        <Button
          size="sm"
          variant="secondary"
          leadingIcon={<Icons.Smartphone size={14} />}
          onClick={() => {
            go.config(null);
            go.phone(true);
          }}
        >
          {t("phone.open")}
        </Button>
      </div>
      <div className="devices__head">
        <SubHead>{t("devices.paired")}</SubHead>
        <Button
          size="sm"
          variant="secondary"
          disabled={busy || Boolean(pairing)}
          leadingIcon={<Icons.Smartphone size={14} />}
          onClick={() => void start()}
        >
          {t("devices.pair")}
        </Button>
      </div>
      {pairing && (
        <div className="devices__pair">
          <div className="devices__head">
            <SubHead>{t("devices.new")}</SubHead>
            <Button size="sm" variant="secondary" disabled={busy} onClick={() => void cancel()}>
              {t("common.cancel")}
            </Button>
          </div>
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
        </div>
      )}
      {!devices && <Skeleton width="100%" height={110} />}
      {devices?.length === 0 && (
        <EmptyState variant="dashed" size="sm" icon={<Icons.Smartphone />}>
          {t("devices.none")}
        </EmptyState>
      )}
      {devices?.map((d) => (
        <DeviceCard key={d.id} device={d} onSaved={async () => void (await load())} onRemove={remove} />
      ))}
      <AccessBlock />
    </>
  );
}

function DeviceCard({
  device,
  onSaved,
  onRemove,
}: {
  device: Device;
  onSaved: () => Promise<void>;
  onRemove: (id: string) => Promise<void>;
}) {
  const t = useT();
  return (
    <div className="devices__card">
      <div className="devices__identity">
        <div className="devices__title">
          <span className="res__name">{device.name}</span>
          <Badge>{t(`devices.platform.${device.platform}`)}</Badge>
        </div>
        <IconButton
          size="sm"
          label={t("devices.remove", { name: device.name })}
          icon={<Icons.Trash2 size={14} />}
          onClick={() => void onRemove(device.id)}
        />
      </div>
      {device.last_seen_at && (
        <span className="devices__seen">
          {t("devices.lastSeen", { when: device.last_seen_at.slice(0, 16).replace("T", " ") })}
        </span>
      )}
      {device.push ? (
        <div className="devices__notifications">
          <span>{t("devices.notifications")}</span>
          <Badge tone="brand">{t(`devices.push.${device.push}`)}</Badge>
        </div>
      ) : (
        <PushField device={device} onSaved={onSaved} />
      )}
    </div>
  );
}

/** A UnifiedPush / ntfy address for a device that cannot register Expo push by itself (an https URL). */
function PushField({ device, onSaved }: { device: Device; onSaved: () => Promise<void> }) {
  const t = useT();
  const fieldId = useId();
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const save = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await client.call("devices.set_push", { id: device.id, push: { kind: "unifiedpush", endpoint: url.trim() } });
      setUrl("");
      await onSaved();
    } catch (e) {
      notify(t("error.devices", { error: e instanceof Error ? e.message : String(e) }));
    } finally {
      setBusy(false);
    }
  };
  return (
    <details className="devices__push">
      <summary>{t("devices.pushConfigure")}</summary>
      <div className="devices__pushBody">
        <p className="pform__hint" id={`${fieldId}-hint`}>
          {t("devices.pushHint")}
        </p>
        <label htmlFor={fieldId}>{t("devices.pushEndpoint")}</label>
        <div className="devices__pushControls">
          <Input
            id={fieldId}
            type="url"
            aria-label={t("devices.pushUrl", { name: device.name })}
            aria-describedby={`${fieldId}-hint`}
            placeholder="https://ntfy.sh/…"
            value={url}
            disabled={busy}
            onChange={(e) => setUrl(e.currentTarget.value)}
          />
          <Button
            size="sm"
            variant="secondary"
            disabled={busy || !/^https:\/\/\S+$/.test(url.trim())}
            onClick={() => void save()}
          >
            {t("devices.pushSave")}
          </Button>
        </div>
      </div>
    </details>
  );
}
