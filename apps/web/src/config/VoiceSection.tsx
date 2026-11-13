import type { NativeVoice, VoiceLocale, VoiceStatus } from "@apx/protocol";
import { Button, Icons, SegmentedControl, SettingRow, Skeleton, Switch } from "@apx/ui";
import { useEffect, useState } from "react";
import { client } from "../data/client.ts";
import { mediaUrl } from "../data/media.ts";
import { loadCatalog, models } from "../data/models.ts";
import { notify } from "../data/notices.ts";
import { installVoice, loadVoice, setVoice, useVoice, voiceId } from "../data/voice.ts";
import { usePack, useT } from "../i18n/index.ts";
import { ModelRefPicker } from "./models/ModelRefPicker.tsx";
import { SectionHead, SubHead } from "./SectionHead.tsx";
import { ServicesSection } from "./ServicesSection.tsx";

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));
const LOCALES: readonly VoiceLocale[] = ["es-AR", "es", "en-US"];
/** What Listen says, in the accent picked (not the panel's language). */
const SAMPLE: Record<VoiceLocale, string> = {
  "es-AR": "Hola, ¿cómo andás? Así suena mi voz.",
  es: "Hola, ¿qué tal? Así suena mi voz.",
  "en-US": "Hi there, how are you? This is how I sound.",
};

/** Settings › Voices: APX's own voice first, the model calls talk with, and other services folded under Advanced. */
export function VoiceSection() {
  return usePack("voice") ? <Voices /> : <Skeleton height={240} shape="block" />;
}

function Voices() {
  const t = useT();
  const s = useVoice();
  const [advanced, setAdvanced] = useState(false);
  useEffect(() => {
    void loadVoice();
  }, []);
  const ours = Boolean(s?.installed && s.enabled);
  return (
    <>
      <SectionHead
        title={t("config.voices")}
        lead={t("voice.lead")}
        actions={
          <Button
            size="sm"
            variant="secondary"
            leadingIcon={<Icons.RefreshCw size={14} />}
            onClick={() => void loadVoice()}
          >
            {t("common.refresh")}
          </Button>
        }
      />
      {s && <VoiceCard s={s} />}
      {s && s.tier !== "none" && <CallModel s={s} />}
      <div>
        <Button
          size="sm"
          variant="ghost"
          aria-expanded={advanced}
          leadingIcon={advanced ? <Icons.ChevronDown size={14} /> : <Icons.ChevronRight size={14} />}
          onClick={() => setAdvanced((a) => !a)}
        >
          {t("voice.advanced")}
        </Button>
      </div>
      {advanced && (
        <>
          <p className="config__lead">{t("voice.advancedHint")}</p>
          <ServicesSection kind="speech" bare localTranscription={!ours} />
        </>
      )}
    </>
  );
}

const run = async (work: () => Promise<unknown>, t: ReturnType<typeof useT>) => {
  try {
    await work();
  } catch (e) {
    notify(t("voice.error", { error: errText(e) }));
  }
};

/** Whether it can run here and why not, its download, or (installed) on/off and the voice it speaks with. */
function VoiceCard({ s }: { s: VoiceStatus }) {
  const t = useT();
  const downloading = s.install?.state === "downloading";
  useEffect(() => {
    if (!downloading) return;
    const iv = setInterval(() => void loadVoice(), 1000);
    return () => clearInterval(iv);
  }, [downloading]);
  const d = s.install;
  const pct = d?.total ? Math.floor((d.received / d.total) * 100) : 0;

  return (
    <div className="localstt">
      <div className="localstt__head">
        <Icons.Mic size={16} />
        <span className="localstt__title">{t("voice.title")}</span>
        {s.installed && (
          <Switch
            size="sm"
            checked={s.enabled}
            label={t("voice.on")}
            onCheckedChange={(on) => void run(() => setVoice({ enabled: on }), t)}
          />
        )}
      </div>
      <p className="localstt__machine">{t("voice.about")}</p>
      {s.tier === "none" ? (
        <>
          <p className="localstt__hint">{t(`voice.missing.${s.missing ?? "platform"}`)}</p>
          {s.missing === "uv" && (
            <p className="localstt__hint">
              <code>brew install uv</code>
            </p>
          )}
          <p className="localstt__hint">{t("voice.elsewhere")}</p>
        </>
      ) : (
        <>
          {s.tier === "light" && <p className="localstt__hint">{t("voice.light")}</p>}
          {!s.installed && !downloading && (
            <div className="localstt__row">
              <span className="localstt__hint">{t("voice.installHint")}</span>
              <Button leadingIcon={<Icons.Download size={14} />} onClick={() => void run(installVoice, t)}>
                {d?.state === "failed" ? t("voice.retry") : t("voice.install")}
              </Button>
            </div>
          )}
          {downloading && (
            <div
              className="localstt__progress"
              role="progressbar"
              aria-valuenow={pct}
              aria-valuemin={0}
              aria-valuemax={100}
            >
              <span style={{ width: `${pct}%` }} />
              <small>{t("voice.downloading", { pct })}</small>
            </div>
          )}
          {d?.state === "failed" && <p className="localstt__error">{t("voice.failed", { error: d.error ?? "" })}</p>}
          {s.installed && <VoicePicker voice={s.voice} disabled={!s.enabled} />}
        </>
      )}
    </div>
  );
}

function VoicePicker({ voice, disabled }: { voice: NativeVoice; disabled: boolean }) {
  const t = useT();
  const [busy, setBusy] = useState(false);
  const pick = (next: NativeVoice) => void run(() => setVoice({ voice: next }), t);
  const listen = async () => {
    setBusy(true);
    await run(async () => {
      const r = await client.call("media.speak", {
        text: SAMPLE[voice.locale],
        service: "apx-voice",
        voice: voiceId(voice),
      });
      await new Audio(await mediaUrl(r.media.id)).play();
    }, t);
    setBusy(false);
  };
  return (
    <>
      <SettingRow title={t("voice.gender")}>
        <SegmentedControl
          size="sm"
          label={t("voice.gender")}
          disabled={disabled}
          value={voice.gender}
          onValueChange={(v) => pick({ ...voice, gender: v === "male" ? "male" : "female" })}
          options={[
            { value: "female", label: t("voice.female") },
            { value: "male", label: t("voice.male") },
          ]}
        />
      </SettingRow>
      <SettingRow title={t("voice.accent")}>
        <SegmentedControl
          size="sm"
          label={t("voice.accent")}
          disabled={disabled}
          value={voice.locale}
          onValueChange={(v) => {
            const locale = LOCALES.find((l) => l === v);
            if (locale) pick({ ...voice, locale });
          }}
          options={LOCALES.map((l) => ({ value: l, label: t(`voice.locale.${l}`) }))}
        />
      </SettingRow>
      <div>
        <Button
          size="sm"
          variant="secondary"
          loading={busy}
          disabled={disabled}
          leadingIcon={<Icons.Volume2 size={14} />}
          onClick={() => void listen()}
        >
          {t("voice.listen")}
        </Button>
      </div>
    </>
  );
}

/** The model a call talks with: the owner's main one, or any other APX has. */
function CallModel({ s }: { s: VoiceStatus }) {
  const t = useT();
  const [picking, setPicking] = useState(false);
  useEffect(() => {
    if (models.get().catalogLoad === "idle") void loadCatalog();
  }, []);
  const mode = s.call_model || picking ? "pick" : "main";
  return (
    <>
      <SubHead>{t("voice.calls")}</SubHead>
      <SettingRow title={t("voice.callModel")} description={t("voice.callModelHint")}>
        <div className="tgtoken">
          <SegmentedControl
            size="sm"
            label={t("voice.callModel")}
            value={mode}
            onValueChange={(v) => {
              setPicking(v === "pick");
              if (v === "main" && s.call_model) void run(() => setVoice({ call_model: null }), t);
            }}
            options={[
              { value: "main", label: t("voice.mainModel") },
              { value: "pick", label: t("voice.pickModel") },
            ]}
          />
          {mode === "pick" && (
            <ModelRefPicker
              label={t("voice.callModel")}
              value={s.call_model}
              placeholder={t("voice.pickModel")}
              onChange={(ref) => void run(() => setVoice({ call_model: ref }), t)}
            />
          )}
        </div>
      </SettingRow>
    </>
  );
}
