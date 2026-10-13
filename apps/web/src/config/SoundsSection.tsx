import { Button, Icons, SegmentedControl, SettingRow, Switch } from "@apx/ui";
import type { NoticeSound } from "../data/noticeSound.ts";
import { setPrefs, usePrefs } from "../data/prefs.ts";
import { useT } from "../i18n/index.ts";
import { previewSound } from "../shell/sounds.ts";
import { SectionHead } from "./SectionHead.tsx";

const MODES: readonly NoticeSound[] = ["all", "messages", "requests", "off"];

/** This device's sounds: the chime after a voice note, and which notices sound as they arrive. */
export function SoundsSection() {
  const t = useT();
  const audioEnd = usePrefs((s) => s.audioEndSound);
  const notice = usePrefs((s) => s.noticeSound);
  const listen = (which: "audioEnd" | "notice") => (
    <Button size="sm" variant="ghost" leadingIcon={<Icons.Play size={13} />} onClick={() => previewSound(which)}>
      {t("sounds.listen")}
    </Button>
  );
  return (
    <>
      <SectionHead title={t("config.sounds")} lead={t("sounds.lead")} />
      <SettingRow title={t("sounds.notices")} description={t("sounds.noticesHint")}>
        <div className="config__row">
          {listen("notice")}
          <SegmentedControl
            size="sm"
            label={t("sounds.notices")}
            value={notice}
            onValueChange={(v) => {
              const mode = MODES.find((m) => m === v) ?? "all";
              setPrefs({ noticeSound: mode });
              if (mode !== "off") previewSound("notice");
            }}
            options={MODES.map((m) => ({ value: m, label: t(`sounds.notices.${m}`) }))}
          />
        </div>
      </SettingRow>
      <SettingRow title={t("sounds.audioEnd")} description={t("sounds.audioEndHint")}>
        <div className="config__row">
          {listen("audioEnd")}
          <Switch
            size="sm"
            checked={audioEnd}
            onCheckedChange={(on) => setPrefs({ audioEndSound: on })}
            aria-label={t("sounds.audioEnd")}
          />
        </div>
      </SettingRow>
    </>
  );
}
