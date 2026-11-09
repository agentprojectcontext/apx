// What every account's settings share: the card of its connection, and linking the owner's own chat on it.
import type { ChannelInfo } from "@apx/protocol";
import { Badge, Button, Input, SettingRow, Switch } from "@apx/ui";
import { type ReactNode, useState } from "react";
import { SubHead } from "../../config/SectionHead.tsx";
import { respondPairing, useChannels } from "../../data/channels.ts";
import { useT } from "../../i18n/index.ts";
import { KindTile } from "../KindIcon.tsx";
import { isChannelKind } from "../kinds.ts";
import { ownerOn } from "../StartRows.tsx";
import type { PaneProps } from "./types.ts";

const STATUS: Record<ChannelInfo["status"], "brand" | "neutral" | "warning" | "danger"> = {
  running: "brand",
  starting: "neutral",
  off: "neutral",
  error: "danger",
};

/** The account as it runs: the number, bot or mailbox it is, its state, and Active; `children` fix or link it. */
export function ConnectionCard({
  channel,
  draft,
  set,
  state,
  children,
}: Pick<PaneProps, "channel" | "draft" | "set"> & { state?: string | undefined; children?: ReactNode }) {
  const t = useT();
  const running = channel.status === "running";
  const now = state ?? t(`tg.status.${channel.status}`);
  return (
    <div className="pcard tgcard">
      <div className="pcard__top">
        {isChannelKind(channel.type) && (
          <span className={`tgcard__tile${running ? "" : " is-idle"}`}>
            <KindTile kind={channel.type} />
          </span>
        )}
        <div className="pcard__titles">
          <div className="pcard__name">{channel.account ?? channel.email?.address ?? channel.label}</div>
          <div className="pcard__id">{now}</div>
        </div>
        <Badge tone={STATUS[channel.status]} dot>
          {channel.enabled ? now : t("providers.off")}
        </Badge>
        <Switch
          size="sm"
          checked={draft.enabled}
          onCheckedChange={(on) => set({ enabled: on })}
          label={t("providers.on")}
        />
      </div>
      {channel.error && <div className="tgcard__error">{channel.error}</div>}
      {children}
    </div>
  );
}

/** Until the owner's own chat is linked, the code the account sent them links it (so it is theirs, not a stranger's). */
export function OwnerLink({ channelId, name }: { channelId: string; name: string }) {
  const t = useT();
  const linked = useChannels((s) => ownerOn(s.persons, channelId));
  const [code, setCode] = useState("");
  if (linked) return null;
  return (
    <>
      <SubHead>{t("tg.yourAccount")}</SubHead>
      <SettingRow title={t("tg.itsMe", { channel: name })} description={t("tg.itsMeHint", { channel: name })}>
        <div className="tgtoken">
          <Input
            aria-label={t("tg.code")}
            inputMode="numeric"
            placeholder="123456"
            value={code}
            onChange={(e) => setCode(e.currentTarget.value.replace(/\D/g, "").slice(0, 6))}
          />
          <Button
            size="sm"
            disabled={code.length !== 6}
            onClick={() => void respondPairing(code, "owner").then(() => setCode(""))}
          >
            {t("tg.link")}
          </Button>
        </div>
      </SettingRow>
    </>
  );
}

/** A number the owner types for a limit; kept in range and saved when they leave the field. */
export function Limit({
  label,
  value,
  min = 0,
  max,
  onSave,
}: {
  label: string;
  value: number;
  min?: number;
  max: number;
  onSave(v: number): void;
}) {
  return (
    <span className="rooms__limit">
      <Input
        key={value}
        aria-label={label}
        type="number"
        min={min}
        max={max}
        className="nudge__num"
        defaultValue={String(value)}
        onBlur={(e) => {
          const v = Math.max(min, Math.min(max, Math.round(Number(e.currentTarget.value) || min)));
          if (v !== value) onSave(v);
        }}
      />
      <span className="pform__hint">{label}</span>
    </span>
  );
}
