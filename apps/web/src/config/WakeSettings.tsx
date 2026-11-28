import type { VoiceStatus } from "@apx/protocol";
import { Button, SettingRow, Switch, TagInput } from "@apx/ui";
import { setWakeListen } from "../call/wakeSwitch.ts";
import { secretary } from "../data/identity.ts";
import { useData } from "../data/state.ts";
import type { setVoice } from "../data/voice.ts";
import { useWake } from "../data/wake.ts";
import { useT } from "../i18n/index.ts";
import { SubHead } from "./SectionHead.tsx";

/**
 * Settings › Voice and calls › Wake by voice: the phrases that wake the super-agent hands-free, and whether this
 * computer listens for them (each phone or computer has its own switch).
 */
export function WakeSettings({
  s,
  save,
}: {
  s: VoiceStatus;
  save: (patch: Parameters<typeof setVoice>[0]) => Promise<void>;
}) {
  const t = useT();
  const on = useWake((w) => w.on);
  const problem = useWake((w) => w.problem);
  const words = s.wake_words ?? [];
  const name = useData((d) => secretary(d.agents)?.name);
  return (
    <>
      <SubHead>{t("wake.title")}</SubHead>
      <p className="config__lead">{t("wake.lead")}</p>
      <SettingRow stacked title={t("wake.words")} description={t("wake.wordsHint")}>
        <div className="tgtoken">
          <TagInput
            label={t("wake.words")}
            value={words}
            {...(name ? { placeholder: t("wake.placeholder", { name }) } : {})}
            addLabel={t("wake.add")}
            removeLabel={t("wake.remove")}
            onValueChange={(next) => void save({ wake_words: next })}
          />
          <Button variant="secondary" size="sm" onClick={() => void save({ wake_words: [] })}>
            {t("wake.reset")}
          </Button>
        </div>
      </SettingRow>
      <SettingRow
        title={t("wake.here")}
        description={
          on && problem ? t(problem === "mic" ? "wake.problem.mic" : "wake.problem.unavailable") : t("wake.hereHint")
        }
      >
        <Switch checked={on} aria-label={t("wake.here")} onCheckedChange={setWakeListen} />
      </SettingRow>
    </>
  );
}
