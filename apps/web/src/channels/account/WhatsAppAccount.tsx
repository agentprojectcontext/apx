import { Button, EmptyState, IconButton, Icons, SettingRow, Spinner, Switch } from "@apx/ui";
import { useMemo, useState } from "react";
import { QrCode } from "../../common/QrCode.tsx";
import { SubHead } from "../../config/SectionHead.tsx";
import { unlinkAddress, useChannels } from "../../data/channels.ts";
import { useT } from "../../i18n/index.ts";
import { PhoneForm, phoneOf } from "../PhoneForm.tsx";
import { ConnectionCard } from "./parts.tsx";
import type { Create, PaneProps } from "./types.ts";

function Steps() {
  const t = useT();
  return (
    <ol className="tgsetup__steps">
      <li>{t("wa.step1")}</li>
      <li>{t("wa.step2")}</li>
      <li>{t("wa.step3")}</li>
    </ol>
  );
}

/**
 * A new WhatsApp account, linked like WhatsApp Web: connecting asks the core for a QR, which shows here to scan from
 * the phone.
 */
export function WhatsAppConnect({ create }: { create: Create }) {
  const t = useT();
  const [busy, setBusy] = useState(false);
  return (
    <div className="acct__connect">
      <div className="acct__qr is-empty">{t("wa.qr")}</div>
      <div className="acct__connecttext">
        <b>{t("wa.linkTitle")}</b>
        <Steps />
        <div>
          <Button
            loading={busy}
            leadingIcon={<Icons.Zap size={14} />}
            onClick={() => {
              setBusy(true);
              void create({
                agent_id: "",
                enabled: true,
                strangers: "pair",
                concurrency: "steer",
                owner_thread: "home",
                self_owner: false,
              }).finally(() => setBusy(false));
            }}
          >
            {t("acct.connect")}
          </Button>
        </div>
      </div>
    </div>
  );
}

/** WhatsApp's connection: the linked number and its QR while one waits, whose phone it is, and the owner's numbers. */
export function WhatsAppAccount({ channel, draft, set, saveNow }: PaneProps) {
  const t = useT();
  const waiting = channel.status === "starting";
  return (
    <>
      <ConnectionCard channel={channel} draft={draft} set={set} state={channel.qr ? t("wa.waitingScan") : undefined}>
        {waiting &&
          (channel.qr ? (
            <div className="waqr">
              <QrCode value={channel.qr} label={t("wa.scan")} />
              <div className="waqr__text">
                <b>{t("wa.scan")}</b>
                <Steps />
                <span className="waqr__hint">{t("wa.scanHint")}</span>
              </div>
            </div>
          ) : (
            <div className="waqr__wait">
              <Spinner size={14} /> {t("wa.connecting")}
            </div>
          ))}
        {channel.status === "error" && (
          <div>
            <Button size="sm" leadingIcon={<Icons.QrCode size={14} />} onClick={() => void saveNow()}>
              {t("wa.relink")}
            </Button>
          </div>
        )}
      </ConnectionCard>
      <SettingRow title={t("ch.selfOwner")} description={t("ch.selfOwnerHint")}>
        <Switch
          size="sm"
          checked={draft.self_owner === true}
          onCheckedChange={(on) => set({ self_owner: on })}
          aria-label={t("ch.selfOwner")}
        />
      </SettingRow>
      {!channel.self_owner && <OwnerPhone channelId={channel.id} />}
    </>
  );
}

/** On a line of its own, the owner's phone: the numbers that are theirs, and one typed by hand. */
function OwnerPhone({ channelId }: { channelId: string }) {
  const t = useT();
  const owner = useChannels((s) => s.persons.find((p) => p.role === "owner"));
  const mine = useMemo(() => owner?.addresses.filter((a) => a.channel === channelId), [owner, channelId]);
  return (
    <>
      <SubHead>{t("ch.phone")}</SubHead>
      {mine?.length ? (
        <ul className="res__list">
          {mine.map((a) => (
            <li key={a.id} className="res__row">
              <Icons.Smartphone size={14} className="res__icon" />
              <div className="res__main">
                <div className="res__name">{phoneOf(a.external_id)}</div>
              </div>
              <IconButton
                size="sm"
                label={t("ch.phoneRemove")}
                icon={<Icons.X size={14} />}
                onClick={() => void unlinkAddress(a.id)}
              />
            </li>
          ))}
        </ul>
      ) : (
        <EmptyState variant="dashed" size="sm" icon={<Icons.Smartphone />}>
          {t("ch.phoneNone")}
        </EmptyState>
      )}
      <SettingRow title={t("ch.phoneAdd")} description={t("ch.phoneAddHint")}>
        <PhoneForm channelId={channelId} />
      </SettingRow>
    </>
  );
}
