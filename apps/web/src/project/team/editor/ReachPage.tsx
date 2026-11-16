import { SettingRow } from "@apx/ui";
import { NoticeChannelSelect } from "../../../config/NoticeChannel.tsx";
import { TeamNews } from "../../../config/TeamNews.tsx";
import { useT } from "../../../i18n/index.ts";

/** How the super-agent reaches the owner: the chat app it writes to, and the team's news in one message. */
export function ReachPage({ onClose }: { onClose(): void }) {
  const t = useT();
  return (
    <>
      <SettingRow title={t("super.where")} description={t("super.whereHint")}>
        <NoticeChannelSelect label={t("super.where")} />
      </SettingRow>
      <TeamNews onLeave={onClose} />
    </>
  );
}
