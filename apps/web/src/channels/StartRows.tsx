import type { ChannelInfo, PairingRequest, Person } from "@apx/protocol";
import { Button, Icons, Input } from "@apx/ui";
import { useState } from "react";
import { shortWhen } from "../common/format.ts";
import { useFlash } from "../common/useFlash.ts";
import { respondPairing, useChannels } from "../data/channels.ts";
import { useT } from "../i18n/index.ts";
import { go } from "../shell/nav.ts";
import { initials } from "./ChannelScreen.tsx";

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
  // Before the owner's own chat is linked, the likely writer is the owner; after, a new person.
  const linked = useChannels((s) => ownerOn(s.persons, request.channel));
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
          {!linked && (
            <Button size="sm" onClick={() => setMine(true)}>
              {t("ch.itsMe")}
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
          {linked && (
            <Button size="sm" variant="ghost" onClick={() => setMine(true)}>
              {t("ch.itsMe")}
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
  return (
    <li>
      <button
        type="button"
        className={`chan__row${selected ? " is-selected" : ""}`}
        aria-current={selected || undefined}
        disabled={!target}
        onClick={() => target && go.channel(channel.id, target)}
      >
        <span className="chan__avatar is-owner">
          <Icons.UserRound size={15} />
        </span>
        <span className="chan__rowmain">
          <span className="chan__rowtop">
            <span className="chan__rowname">{t("ch.you")}</span>
          </span>
          <span className="chan__preview">
            {t(toHome ? "ch.ownerHome" : target ? "ch.ownerOwn" : "ch.ownerOwnNone")}
          </span>
        </span>
      </button>
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
