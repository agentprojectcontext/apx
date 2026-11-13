import type { NativeVoice, VoiceLocale, VoiceStatus } from "@apx/protocol";
import { Button, Icons, SegmentedControl, Switch } from "@apx/ui";
import { useEffect, useState } from "react";
import { client } from "../data/client.ts";
import { mediaUrl } from "../data/media.ts";
import { notify } from "../data/notices.ts";
import { installVoice, loadVoice, setVoice, voiceId } from "../data/voice.ts";
import { useT } from "../i18n/index.ts";

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));
const LOCALES: readonly VoiceLocale[] = ["es-AR", "es", "en-US"];
/** What Listen says, in the accent picked (not the panel's language). */
const SAMPLE: Record<VoiceLocale, string> = {
  "es-AR": "Hola, ¿cómo andás? Así suena mi voz.",
  es: "Hola, ¿qué tal? Así suena mi voz.",
  "en-US": "Hi there, how are you? This is how I sound.",
};

type T = ReturnType<typeof useT>;
const run = async (work: () => Promise<unknown>, t: T) => {
  try {
    await work();
  } catch (e) {
    notify(t("voice.error", { error: errText(e) }));
  }
};

/**
 * APX's own voice as the first row of Voices (`speech`: install, on/off, its voice and Listen) or of Transcription
 * (on/off; it installs from Voices). Where it can't run, the row says why.
 */
export function VoiceRow({ kind, status: s }: { kind: "speech" | "transcription"; status: VoiceStatus }) {
  const t = useT();
  const speech = kind === "speech";
  const downloading = s.install?.state === "downloading";
  // One row follows the download (the Voices one), so the core is asked once a second, not twice.
  useEffect(() => {
    if (!downloading || !speech) return;
    const iv = setInterval(() => void loadVoice(), 1000);
    return () => clearInterval(iv);
  }, [downloading, speech]);
  const d = s.install;
  const pct = d?.total ? Math.floor((d.received / d.total) * 100) : 0;
  const can = s.tier !== "none";

  return (
    <>
      <div className="res__main">
        <div className="res__name">
          APX <span className="voicerow__where">{t("voice.here")}</span>
        </div>
        <div className="res__desc">{t(speech ? "voice.speaks" : "voice.hears")}</div>
        {!can && (
          <div className="res__desc">
            {t(`voice.missing.${s.missing ?? "platform"}`)}
            {s.missing === "uv" && (
              <>
                {" "}
                <code>brew install uv</code>
              </>
            )}
          </div>
        )}
        {can && s.tier === "light" && speech && <div className="res__desc">{t("voice.light")}</div>}
        {can && !s.installed && !downloading && !speech && <div className="res__desc">{t("voice.installsAbove")}</div>}
        {can && speech && !s.installed && !downloading && (
          <div className="voicerow__line">
            <Button size="sm" leadingIcon={<Icons.Download size={14} />} onClick={() => void run(installVoice, t)}>
              {d?.state === "failed" ? t("voice.retry") : t("voice.install")}
            </Button>
            <span className="res__desc">{t(s.tier === "light" ? "voice.installLight" : "voice.installFull")}</span>
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
        {speech && d?.state === "failed" && (
          <div className="res__desc svc__why" role="status">
            {t("voice.failed", { error: d.error ?? "" })}
          </div>
        )}
      </div>
      {can && s.installed && (
        <Switch
          size="sm"
          checked={s.enabled}
          aria-label={t("voice.on")}
          onCheckedChange={(on) => void run(() => setVoice({ enabled: on }), t)}
        />
      )}
      {speech && s.installed && s.enabled && <VoicePicker voice={s.voice} />}
    </>
  );
}

/** Female or male, the accent, and Listen to hear it. */
function VoicePicker({ voice }: { voice: NativeVoice }) {
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
    <div className="voicerow__line voicerow__picker">
      <SegmentedControl
        size="sm"
        label={t("voice.gender")}
        value={voice.gender}
        onValueChange={(v) => pick({ ...voice, gender: v === "male" ? "male" : "female" })}
        options={[
          { value: "female", label: t("voice.female") },
          { value: "male", label: t("voice.male") },
        ]}
      />
      <SegmentedControl
        size="sm"
        label={t("voice.accent")}
        value={voice.locale}
        onValueChange={(v) => {
          const locale = LOCALES.find((l) => l === v);
          if (locale) pick({ ...voice, locale });
        }}
        options={LOCALES.map((l) => ({ value: l, label: t(`voice.locale.${l}`) }))}
      />
      <Button
        size="sm"
        variant="secondary"
        loading={busy}
        leadingIcon={<Icons.Volume2 size={14} />}
        onClick={() => void listen()}
      >
        {t("voice.listen")}
      </Button>
    </div>
  );
}
