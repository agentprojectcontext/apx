import type { ServiceInfo, VoiceStatus } from "@apx/protocol";
import { Button, SegmentedControl, Select, SettingRow, Switch } from "@apx/ui";
import { useEffect, useState } from "react";
import { loadCallStatus } from "../call/callStatus.ts";
import { loadCatalog, models } from "../data/models.ts";
import { notify } from "../data/notices.ts";
import { loadVoice, setVoice, useVoice } from "../data/voice.ts";
import { useT } from "../i18n/index.ts";
import { ModelRefPicker } from "./models/ModelRefPicker.tsx";

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** The calls part of Settings › Voice and calls: whether calls are offered, and the model a call talks with. */
export function CallsSettings({
  speech,
  hearing,
  onManage,
}: {
  speech: ServiceInfo[] | undefined;
  hearing: ServiceInfo[] | undefined;
  onManage: () => void;
}) {
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
  if (!s) return null;
  const engine = s.call_engine ?? (s.tier === "none" ? "services" : "native");
  return (
    <>
      <SettingRow title={t("calls.allow")} description={t(s.calls ? "calls.allowHint" : "calls.offHint")}>
        <Switch checked={s.calls} aria-label={t("calls.allow")} onCheckedChange={(on) => void save({ calls: on })} />
      </SettingRow>
      {s.calls && (
        <>
          <SettingRow
            title={t("calls.audio")}
            description={t(engine === "services" ? "calls.servicesHint" : "calls.nativeHint")}
          >
            <SegmentedControl
              size="sm"
              label={t("calls.audio")}
              value={engine}
              onValueChange={(v) => void save({ call_engine: v === "services" ? "services" : "native" })}
              options={[
                { value: "native", label: t("calls.native") },
                { value: "services", label: t("calls.services") },
              ]}
            />
          </SettingRow>
          {engine === "native" && s.tier === "none" && <p className="config__lead">{t("calls.nativeUnavailable")}</p>}
          {engine === "services" && (
            <>
              <CallService kind="speech" services={speech} selected={s.call_speech} save={save} />
              <CallService kind="transcription" services={hearing} selected={s.call_transcription} save={save} />
              <Button variant="secondary" size="sm" onClick={onManage}>
                {t("calls.manageServices")}
              </Button>
            </>
          )}
          <CallModel s={s} save={save} />
        </>
      )}
    </>
  );
}

function CallService({
  kind,
  services,
  selected,
  save,
}: {
  kind: "speech" | "transcription";
  services: ServiceInfo[] | undefined;
  selected: string | undefined;
  save: (patch: Parameters<typeof setVoice>[0]) => Promise<void>;
}) {
  const t = useT();
  const enabled = services?.filter((s) => s.enabled) ?? [];
  const options = [
    { value: "", label: t("calls.firstAvailable") },
    ...enabled.map((s) => ({ value: s.id, label: s.label })),
  ];
  if (selected && !enabled.some((s) => s.id === selected))
    options.push({ value: selected, label: t("calls.serviceUnavailable") });
  return (
    <SettingRow
      title={t(`calls.${kind}`)}
      description={t(enabled.length ? "calls.serviceHint" : `calls.empty.${kind}`)}
    >
      <Select
        size="sm"
        label={t(`calls.${kind}`)}
        disabled={!services}
        value={selected ?? ""}
        options={options}
        onValueChange={(id) =>
          void save(kind === "speech" ? { call_speech: id || null } : { call_transcription: id || null })
        }
      />
    </SettingRow>
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
