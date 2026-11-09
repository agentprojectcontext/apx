import type { OutboxItem } from "@apx/protocol";
import { Badge, EmptyState, Icons } from "@apx/ui";
import { useEffect, useState } from "react";
import { shortWhen } from "../../common/format.ts";
import { client } from "../../data/client.ts";
import { type T, useT } from "../../i18n/index.ts";
import type { PaneProps } from "./types.ts";

const TONE: Record<OutboxItem["state"], "neutral" | "danger" | "warning"> = {
  queued: "neutral",
  sending: "neutral",
  sent: "neutral",
  failed: "danger",
  uncertain: "warning",
};

/** What went out without words: a sticker (with what it shows) or an emoji put on a message. */
function sentLabel(o: OutboxItem, t: T): string {
  if (o.sticker !== undefined) return o.sticker ? t("tg.out.stickerAbout", { about: o.sticker }) : t("tg.out.sticker");
  return o.reaction ? t("tg.out.reaction", { emoji: o.reaction }) : "";
}

/** What went out on this account lately, newest first: each message's state, and why one failed. */
export function ActivityPane({ channel }: Pick<PaneProps, "channel">) {
  const t = useT();
  const [items, setItems] = useState<OutboxItem[]>();
  useEffect(() => {
    let live = true;
    const read = () =>
      void client
        .call("channels.outbox", { channel: channel.id, limit: 50 })
        .then((r) => live && setItems(r.items))
        .catch(() => live && setItems([]));
    read();
    const id = setInterval(read, 5000);
    return () => {
      live = false;
      clearInterval(id);
    };
  }, [channel.id]);
  if (!items) return null;
  if (!items.length)
    return (
      <EmptyState variant="dashed" size="sm" icon={<Icons.Activity />}>
        {t("acct.noActivity")}
      </EmptyState>
    );
  return (
    <ul className="acct__log">
      {items.map((o) => (
        <li key={o.id} className="acct__logrow">
          <span className="acct__logtime">{shortWhen(o.created_at)}</span>
          <span className="acct__logtext">
            {o.text || sentLabel(o, t)}
            {o.error && o.state !== "sent" && <span className="tgcard__error">{o.error}</span>}
          </span>
          {o.state !== "sent" && (
            <Badge tone={TONE[o.state]} dot>
              {t(`tg.out.${o.state}`)}
            </Badge>
          )}
        </li>
      ))}
    </ul>
  );
}
