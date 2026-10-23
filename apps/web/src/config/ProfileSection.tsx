import { Button, Icons, SettingRow } from "@apx/ui";
import { useData } from "../data/state.ts";
import { useT } from "../i18n/index.ts";
import { go } from "../shell/nav.ts";
import { NoticeChannelSelect } from "./NoticeChannel.tsx";
import { ProfilePicker } from "./ProfilePicker.tsx";
import { SectionHead, SubHead } from "./SectionHead.tsx";

/** The super-agent: where it writes to the owner, how often, and what it is for (its profile). */
export function ProfileSection() {
  const t = useT();
  const superAgent = useData((s) => Object.values(s.agents).find((a) => a.kind === "secretary"));
  return (
    <>
      <SectionHead
        title={t("config.superagent")}
        lead={t("super.lead", { name: superAgent?.name ?? t("config.superagent") })}
        actions={
          superAgent && (
            <Button
              size="sm"
              variant="secondary"
              leadingIcon={<Icons.Bot size={14} />}
              onClick={() => {
                go.config(null);
                go.agent(superAgent.id);
              }}
            >
              {t("super.edit", { name: superAgent.name })}
            </Button>
          )
        }
      />
      <SubHead>{t("super.talk")}</SubHead>
      <SettingRow title={t("super.where")} description={t("super.whereHint")}>
        <NoticeChannelSelect label={t("super.where")} />
      </SettingRow>
      <SettingRow title={t("prof.budget")} description={t("prof.budgetHint")}>
        <Button size="sm" variant="secondary" onClick={() => go.config("interruptions")}>
          {t("nudge.open")}
        </Button>
      </SettingRow>

      <SubHead>{t("config.profile")}</SubHead>
      <ProfilePicker />
    </>
  );
}
