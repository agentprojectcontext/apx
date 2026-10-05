import { EmptyState, Icons, SettingRow, Switch } from "@apx/ui";
import { useEffect } from "react";
import { KindTile } from "../channels/KindIcon.tsx";
import { loadChannels, setIMessage, useChannels } from "../data/channels.ts";
import { useT } from "../i18n/index.ts";

/**
 * iMessage is not a channel agents answer on: it lends them two tools on this Mac (read recent messages, send one
 * with your OK). Off until the owner turns it on; only a Mac has it.
 */
export function IMessageSection() {
  const t = useT();
  const im = useChannels((s) => s.imessage);
  useEffect(() => {
    void loadChannels();
  }, []);
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
      <SettingRow title={t("im.toggle")} description={t("im.toggleHint")}>
        <Switch checked={im.on} onCheckedChange={(on) => void setIMessage(on)} aria-label={t("im.toggle")} />
      </SettingRow>
      <ol className="tgsetup__steps">
        <li>{t("im.step1")}</li>
        <li>{t("im.step2")}</li>
      </ol>
    </>
  );
}
