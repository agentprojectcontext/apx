import type { ChannelInfo, PairingRequest, Person } from "@apx/protocol";
import { Button, Icons, Input } from "@apx/ui";
import { useState } from "react";
import { shortWhen } from "../common/format.ts";
import { useFlash } from "../common/useFlash.ts";
import { respondPairing, useChannels } from "../data/channels.ts";
import { type MessageKey, useT } from "../i18n/index.ts";
import { go } from "../shell/nav.ts";
import { PersonAvatar } from "./PersonAvatar.tsx";
import { PhoneForm, phoneOf } from "./PhoneForm.tsx";
import { initials } from "./people.ts";

/**
 * Someone who wrote and waits to be let in, first in the list with what they said. "It's me" asks for the code the
 * bot sent — so the owner links their own chat, never a stranger's — and "Contact" or "Ignore" answer at once.
 */
export function PairingRow({ request }: { request: PairingRequest }) {
  const t = useT();
  const [mine, setMine] = useState(false);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const { ref, flash } = useFlash<HTMLLIElement>(`pairing:${request.code}`);
  // Before the owner's own chat is linked, the likely writer is the owner; after, a new person. On the owner's own
  // number (WhatsApp) it is never the owner.
  const linked = useChannels((s) => ownerOn(s.persons, request.channel));
  const channel = useChannels((s) => s.channels.find((c) => c.id === request.channel));
  // WhatsApp shows the number, so the owner can tell their own phone at a glance; on their own number it is never them.
  const whatsapp = channel?.type === "whatsapp";
  const ownNumber = whatsapp && channel?.self_owner === true;
  const itsMe = () => (whatsapp ? void answer(request.code, "owner") : setMine(true));
  const answer = async (c: string, decision: "owner" | "contact" | "deny") => {
    setBusy(true);
    await respondPairing(c, decision);
    setBusy(false);
  };
  return (
    <li ref={ref} className={`chan__pending${flash ? " is-flash" : ""}`}>
      <div className="chan__row is-unread">
        <span className="chan__avatar">{initials(request.name)}</span>
        <span className="chan__rowmain">
          <span className="chan__rowtop">
            <span className="chan__rowname">{request.name}</span>
            {whatsapp && <span className="chan__rowphone">{phoneOf(request.external_id)}</span>}
            <span className="chan__rowtime">{shortWhen(request.created_at)}</span>
          </span>
          {request.text && <span className="chan__preview">“{request.text}”</span>}
          <span className="chan__rel">{t("ch.pending")}</span>
        </span>
      </div>
      {mine ? (
        <div className="chan__pendingact">
          <Input
            aria-label={t("tg.code")}
            autoFocus
            inputMode="numeric"
            placeholder="123456"
            value={code}
            onChange={(e) => setCode(e.currentTarget.value.replace(/\D/g, "").slice(0, 6))}
            onKeyDown={(e) => e.key === "Enter" && code.length === 6 && void answer(code, "owner")}
          />
          <Button size="sm" variant="ghost" onClick={() => setMine(false)}>
            {t("common.cancel")}
          </Button>
          <Button size="sm" disabled={code.length !== 6} loading={busy} onClick={() => void answer(code, "owner")}>
            {t("tg.link")}
          </Button>
        </div>
      ) : (
        <div className="chan__pendingact">
          {!linked && !ownNumber && (
            <Button size="sm" loading={busy && whatsapp} onClick={itsMe}>
              {t(whatsapp ? "ch.itsMyNumber" : "ch.itsMe")}
            </Button>
          )}
          <Button
            size="sm"
            variant={linked ? "primary" : "secondary"}
            loading={busy}
            onClick={() => void answer(request.code, "contact")}
          >
            {t("ch.acceptContact")}
          </Button>
          <Button size="sm" variant="ghost" disabled={busy} onClick={() => void answer(request.code, "deny")}>
            {t("tg.ignore")}
          </Button>
          {linked && !ownNumber && (
            <Button size="sm" variant="ghost" disabled={busy} onClick={itsMe}>
              {t(whatsapp ? "ch.itsMyNumber" : "ch.itsMe")}
            </Button>
          )}
        </div>
      )}
      {mine && <p className="chan__pendinghint">{t("ch.itsMeHint")}</p>}
    </li>
  );
}

/**
 * The owner's own chat with the bot, opened beside the list: Home (one conversation everywhere) or, with "Own chat",
 * this channel's chat of theirs once they have written to the bot.
 */
export function OwnerRow({
  channel,
  target,
  selected,
}: {
  channel: ChannelInfo;
  target: string | undefined;
  selected: boolean;
}) {
  const t = useT();
  const toHome = channel.owner_thread === "home";
  const owner = useChannels((s) => s.persons.find((p) => p.role === "owner"));
  return (
    <li>
      <button
        type="button"
        className={`chan__row${selected ? " is-selected" : ""}`}
        aria-current={selected || undefined}
        disabled={!target}
        onClick={() => target && go.channel(channel.id, target)}
      >
        <PersonAvatar personId={owner?.id} className="chan__avatar is-owner" fallback={<Icons.UserRound size={15} />} />
        <span className="chan__rowmain">
          <span className="chan__rowtop">
            <span className="chan__rowname">
              {owner?.nickname ? t("ch.youNamed", { name: owner.nickname }) : t("ch.you")}
            </span>
          </span>
          <span className="chan__preview">{t(ownerLine(channel)[toHome ? "home" : target ? "own" : "none"])}</span>
        </span>
      </button>
    </li>
  );
}

type OwnerLine = Record<"home" | "own" | "none", MessageKey>;
const OWNER_BOT: OwnerLine = { home: "ch.ownerHome", own: "ch.ownerOwn", none: "ch.ownerOwnNone" };
/** On the owner's own WhatsApp number they write in "Message yourself"; to a line of its own, from their phone. */
const OWNER_WA: OwnerLine = { home: "ch.waOwnerHome", own: "ch.waOwnerOwn", none: "ch.waOwnerOwnNone" };
const OWNER_LINE: OwnerLine = { home: "ch.waPhoneHome", own: "ch.waPhoneOwn", none: "ch.waPhoneOwnNone" };
const ownerLine = (c: ChannelInfo) => (c.type !== "whatsapp" ? OWNER_BOT : c.self_owner ? OWNER_WA : OWNER_LINE);

/**
 * WhatsApp on a line of its own, until the owner's phone is linked: write to the line and tap "It's my number" when it
 * shows up in the list, or type the number.
 */
export function LinkPhone({ channel }: { channel: ChannelInfo }) {
  const t = useT();
  return (
    <li className="chan__link">
      <div className="chan__linktitle">
        <Icons.Smartphone size={14} />
        {t("ch.linkPhone.title")}
      </div>
      <ol className="chan__linksteps">
        <li>{t("ch.linkPhone.step1", { line: channel.account ?? channel.label })}</li>
        <li>{t("ch.linkPhone.step2")}</li>
      </ol>
      <div className="chan__pendingact is-flat">
        <PhoneForm channelId={channel.id} />
      </div>
    </li>
  );
}

/**
 * Until the owner's own chat is linked, always on top: open the bot, write to it, and type here the code it answers
 * with — the same code check as "It's me", so only the owner's own chat becomes theirs.
 */
export function LinkMe({ channel }: { channel: ChannelInfo }) {
  const t = useT();
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const bot = channel.account?.replace(/^@/, "");
  const link = async () => {
    if (code.length !== 6) return;
    setBusy(true);
    await respondPairing(code, "owner");
    setBusy(false);
    setCode("");
  };
  return (
    <li className="chan__link">
      <div className="chan__linktitle">
        <Icons.Link size={14} />
        {t("ch.link.title")}
      </div>
      <ol className="chan__linksteps">
        <li>
          {bot ? (
            <button
              type="button"
              className="chan__linkbot"
              onClick={() => window.open(`https://t.me/${bot}`, "_blank", "noopener")}
            >
              {t("ch.link.step1", { bot: channel.account ?? bot })}
              <Icons.ExternalLink size={12} />
            </button>
          ) : (
            t("ch.link.step1", { bot: t("ch.link.yourBot") })
          )}
        </li>
        <li>{t("ch.link.step2")}</li>
      </ol>
      <div className="chan__pendingact is-flat">
        <Input
          aria-label={t("tg.code")}
          inputMode="numeric"
          placeholder="123456"
          value={code}
          onChange={(e) => setCode(e.currentTarget.value.replace(/\D/g, "").slice(0, 6))}
          onKeyDown={(e) => e.key === "Enter" && void link()}
        />
        <Button size="sm" disabled={code.length !== 6} loading={busy} onClick={() => void link()}>
          {t("tg.link")}
        </Button>
      </div>
    </li>
  );
}

/** Whether the owner already linked a chat on this channel. */
export const ownerOn = (persons: Person[], channelId: string) =>
  persons.some((p) => p.role === "owner" && p.addresses.some((a) => a.channel === channelId));
