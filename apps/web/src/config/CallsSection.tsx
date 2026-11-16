import type { VoiceStatus } from "@apx/protocol";
import { SegmentedControl, SettingRow, Switch } from "@apx/ui";
import { useEffect, useState } from "react";
import { loadCallStatus } from "../call/callStatus.ts";
import { loadCatalog, models } from "../data/models.ts";
import { notify } from "../data/notices.ts";
import { loadVoice, setVoice, useVoice } from "../data/voice.ts";
import { useT } from "../i18n/index.ts";
import { ModelRefPicker } from "./models/ModelRefPicker.tsx";

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** The calls part of Settings › Voice and calls: whether calls are offered, and the model a call talks with. */
export function CallsSettings() {
  const t = useT();
  const s = useVoice();
  useEffect(() => {
    void loadVoice();
  }, []);
  const save = async (patch: Parameters<typeof setVoice>[0]) => {
    try {
      await setVoice(patch);
    } catch (e) {
      notify(t("voice.error", { error: errText(e) }));
    }
    // The call buttons across the panel follow at once.
    void loadCallStatus();
  };
  return (
    <>
      {s?.tier === "none" ? (
        <p className="config__lead">{t("calls.cantRun")}</p>
      ) : (
        s && (
          <>
            <SettingRow title={t("calls.allow")} description={t(s.calls ? "calls.allowHint" : "calls.offHint")}>
              <Switch
                checked={s.calls}
                aria-label={t("calls.allow")}
                onCheckedChange={(on) => void save({ calls: on })}
              />
            </SettingRow>
            {s.calls && <CallModel s={s} save={save} />}
          </>
        )
      )}
    </>
  );
}

/** The model a call talks with: the owner's main one, or any other APX has. */
function CallModel({ s, save }: { s: VoiceStatus; save: (patch: Parameters<typeof setVoice>[0]) => Promise<void> }) {
  const t = useT();
  const [picking, setPicking] = useState(false);
  useEffect(() => {
    if (models.get().catalogLoad === "idle") void loadCatalog();
  }, []);
  const mode = s.call_model || picking ? "pick" : "main";
  return (
    <SettingRow title={t("calls.model")} description={t("calls.modelHint")}>
      <div className="tgtoken">
        <SegmentedControl
          size="sm"
          label={t("calls.model")}
          value={mode}
          onValueChange={(v) => {
            setPicking(v === "pick");
            if (v === "main" && s.call_model) void save({ call_model: null });
          }}
          options={[
            { value: "main", label: t("calls.mainModel") },
            { value: "pick", label: t("calls.pickModel") },
          ]}
        />
        {mode === "pick" && (
          <ModelRefPicker
            label={t("calls.model")}
            value={s.call_model}
            placeholder={t("calls.pickModel")}
            onChange={(ref) => void save({ call_model: ref })}
          />
        )}
      </div>
    </SettingRow>
  );
}
