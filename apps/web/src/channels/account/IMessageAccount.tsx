import { Button, EmptyState, Icons, SettingRow, Switch } from "@apx/ui";
import { useState } from "react";
import { setIMessage, useChannels } from "../../data/channels.ts";
import { useT } from "../../i18n/index.ts";
import { KindTile } from "../KindIcon.tsx";
import { ConnectionCard, OwnerLink } from "./parts.tsx";
import type { Create, PaneProps } from "./types.ts";

/** iMessage as tools agents use on this Mac (read recent messages, send one with your OK); only a Mac has it. */
function Tools() {
  const t = useT();
  const im = useChannels((s) => s.imessage);
  if (!im?.available) return null;
  return (
    <SettingRow title={t("im.toggle")} description={t("im.toggleHint")}>
      <Switch checked={im.on} onCheckedChange={(on) => void setIMessage(on)} aria-label={t("im.toggle")} />
    </SettingRow>
  );
}

/** iMessage on this Mac: the tools, and Connect, which answers the people who write once you approve them. */
export function IMessageConnect({ create }: { create: Create }) {
  const t = useT();
  const im = useChannels((s) => s.imessage);
  const [busy, setBusy] = useState(false);
  if (!im) return null;
  if (!im.available)
    return (
      <div className="channelcfg">
        <KindTile kind="imessage" size={40} />
        <EmptyState variant="dashed" icon={<Icons.Monitor />} title={t("im.onlyMac")}>
          {t("im.onlyMacBody")}
        </EmptyState>
      </div>
    );
  return (
    <>
      <Tools />
      <ol className="tgsetup__steps">
        <li>{t("im.step1")}</li>
        <li>{t("im.step2")}</li>
      </ol>
      <SettingRow title={t("im.answer")} description={t("im.answerHint")}>
        <Button
          size="sm"
          loading={busy}
          onClick={() => {
            setBusy(true);
            void create({
              agent_id: "",
              enabled: true,
              strangers: "pair",
              concurrency: "steer",
              owner_thread: "home",
            }).finally(() => setBusy(false));
          }}
        >
          {t("acct.connect")}
        </Button>
      </SettingRow>
    </>
  );
}

export function IMessageAccount(pane: PaneProps) {
  return (
    <>
      <ConnectionCard {...pane} />
      <Tools />
      <OwnerLink channelId={pane.channel.id} name="iMessage" />
    </>
  );
}
