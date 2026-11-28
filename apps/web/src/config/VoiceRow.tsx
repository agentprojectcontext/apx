import type { NativeVoice, VoiceLocale, VoiceStatus } from "@apx/protocol";
import { Button, Icons, SegmentedControl, Switch } from "@apx/ui";
import { useEffect, useState } from "react";
import { client } from "../data/client.ts";
import { mediaUrl } from "../data/media.ts";
import { notify } from "../data/notices.ts";
import { installVoice, loadVoice, setVoice, voiceId } from "../data/voice.ts";
import { useLanguage, useT } from "../i18n/index.ts";
import { GreetingNote } from "./GreetingNote.tsx";
import { greetingNoteAt } from "./greetingNote.ts";

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));
/** Each language's accents, the neutral one first. */
const ACCENTS: Record<"es" | "en", readonly [VoiceLocale, ...VoiceLocale[]]> = { es: ["es", "es-AR"], en: ["en-US"] };
const langOf = (l: VoiceLocale): "es" | "en" => (l.startsWith("en") ? "en" : "es");
/** What Try says, in the accent picked (not the panel's language). */
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
 * APX's own voice as the first row of Speak (`speech`: install, on/off, its voice and Try) or of Hear (on/off, and
 * an install of only what hears). Where it can't run, the row says why.
 */
export function VoiceRow({ kind, status: s }: { kind: "speech" | "transcription"; status: VoiceStatus }) {
  const t = useT();
  const lang = useLanguage();
  const speech = kind === "speech";
  // Hearing downloads alone or with the rest; this row shows the download that brings what it needs.
  const part = s.install?.part ?? "all";
  const mine = speech ? part === "all" : part === "ears";
  const downloading = s.install?.state === "downloading";
  const here = speech ? s.installed : s.hears_installed;
  // The row of the download asks the core once a second, not both rows.
  useEffect(() => {
    if (!downloading || !mine) return;
    const iv = setInterval(() => void loadVoice(), 1000);
    return () => clearInterval(iv);
  }, [downloading, mine]);
  const d = mine ? s.install : undefined;
  const pct = d?.total ? Math.floor((d.received / d.total) * 100) : 0;
  const can = s.tier !== "none";

  return (
    <>
      <div className="res__main">
        <div className="res__name">
          APX <span className="voicerow__where">{t("voice.here")}</span>
        </div>
        <div className="res__desc">{t(speech ? "voice.speaks" : "voice.hears")}</div>
        {can && s.models && (
          <div className="res__desc">
            {speech
              ? t("voice.models.speaks", { name: s.models.speaks, gb: s.models.size_gb, folder: s.models.folder })
              : t("voice.models.hears", { name: s.models.hears })}
          </div>
        )}
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
        {can && s.tier === "light" && speech && !s.can_full && <div className="res__desc">{t("voice.light")}</div>}
        {can && speech && s.can_full && (
          <div className="voicerow__line">
            <SegmentedControl
              size="sm"
              label={t("voice.quality")}
              value={s.tier === "full" ? "full" : "light"}
              onValueChange={(v) => void run(() => setVoice({ quality: v === "full" ? "full" : "light" }), t)}
              options={[
                { value: "light", label: t("voice.quality.light") },
                { value: "full", label: t("voice.quality.full") },
              ]}
            />
            <span className="res__desc">{t("voice.qualityHint")}</span>
          </div>
        )}
        {can && !here && !speech && downloading && part === "all" && (
          <div className="res__desc">{t("voice.installsAbove")}</div>
        )}
        {can && !here && !(downloading && (mine || (!speech && part === "all"))) && (
          <div className="voicerow__line">
            <Button
              size="sm"
              leadingIcon={<Icons.Download size={14} />}
              disabled={downloading}
              onClick={() => void run(() => installVoice(speech ? undefined : "ears"), t)}
            >
              {d?.state === "failed" ? t("voice.retry") : t("voice.install")}
            </Button>
            <span className="res__desc">
              {speech
                ? t(s.tier === "light" ? "voice.installLight" : "voice.installFull")
                : t("voice.installHear", { gb: (s.models?.hears_gb ?? 1).toLocaleString(lang) })}
            </span>
          </div>
        )}
        {downloading && mine && (
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
        {d?.state === "failed" && (
          <div className="res__desc svc__why" role="status">
            {t("voice.failed", { error: d.error ?? "" })}
          </div>
        )}
      </div>
      {can && here && (
        <Switch
          size="sm"
          checked={s.enabled}
          aria-label={t("voice.on")}
          onCheckedChange={(on) => void run(() => setVoice({ enabled: on }), t)}
        />
      )}
      {speech && s.installed && s.enabled && <VoicePicker voice={s.voice} />}
      {speech && greetingNoteAt(s) === "voice" && <GreetingNote className="res__desc voicerow__note" />}
    </>
  );
}

/** Female or male, the language and then its accent, and Try to hear it. */
function VoicePicker({ voice }: { voice: NativeVoice }) {
  const t = useT();
  const [busy, setBusy] = useState(false);
  const pick = (next: NativeVoice) => void run(() => setVoice({ voice: next }), t);
  const lang = langOf(voice.locale);
  const accents = ACCENTS[lang];
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
        label={t("voice.language")}
        value={lang}
        onValueChange={(v) => {
          const next = v === "en" ? "en" : "es";
          if (next !== lang) pick({ ...voice, locale: ACCENTS[next][0] });
        }}
        options={[
          { value: "es", label: t("voice.lang.es") },
          { value: "en", label: t("voice.lang.en") },
        ]}
      />
      {/* An accent to pick only where the language has more than one. */}
      {accents.length > 1 && (
        <SegmentedControl
          size="sm"
          label={t("voice.accent")}
          value={voice.locale}
          onValueChange={(v) => {
            const locale = accents.find((l) => l === v);
            if (locale) pick({ ...voice, locale });
          }}
          options={accents.map((l) => ({ value: l, label: t(`voice.accent.${l}`) }))}
        />
      )}
      <Button
        size="sm"
        variant="secondary"
        loading={busy}
        leadingIcon={<Icons.Volume2 size={14} />}
        onClick={() => void listen()}
      >
        {t("voice.try")}
      </Button>
    </div>
  );
}
