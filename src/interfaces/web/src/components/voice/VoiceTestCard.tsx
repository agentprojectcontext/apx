import { useState } from "react";
import { Play, Square, Volume2 } from "lucide-react";
import { Button, Field, Input, Textarea } from "../ui";
import { UiSelect } from "../UiSelect";
import { useToast } from "../Toast";
import { useTtsPlayer } from "./useTtsPlayer";
import { Voice, TTS_PROVIDER_META, type TtsEngineInfo, type TtsMode, type TtsSayResult } from "../../lib/api/voice";
import { t } from "../../i18n";

// "Decir esto" tester. Lets you pick which engine to synthesize with (overriding
// the saved default) and add a free-text speaking-style instruction, then plays
// the resulting audio in-browser via /tts/say. Style only affects engines that
// support it (today: Gemini); other engines ignore it.

interface Props {
  engines: TtsEngineInfo[];
  /** Saved single-mode default ("auto" = use the chain/router). */
  defaultProvider: string;
  mode: TtsMode;
}

export function VoiceTestCard({ engines, defaultProvider, mode }: Props) {
  const toast = useToast();
  const { play, stop, playing, loading: playLoading } = useTtsPlayer();
  const [text, setText] = useState(t("voice_ui.test_default_text"));
  // "" = use the saved default; otherwise force a specific engine.
  const [engine, setEngine] = useState("");
  const [style, setStyle] = useState("");
  const [busy, setBusy] = useState(false);
  const [last, setLast] = useState<TtsSayResult | null>(null);

  const defaultLabel =
    mode === "single" && defaultProvider && defaultProvider !== "auto"
      ? t("voice_ui.test_default_engine", { name: TTS_PROVIDER_META[defaultProvider]?.name || defaultProvider })
      : t("voice_ui.test_default_chain");

  const options = [
    { value: "", label: defaultLabel },
    ...engines.map((e) => ({
      value: e.id,
      label: `${TTS_PROVIDER_META[e.id]?.name || e.id}${e.available ? "" : t("voice_ui.test_unavailable_suffix")}`,
    })),
  ];

  const say = async () => {
    const txt = text.trim();
    if (!txt) {
      toast.error(t("voice_ui.test_empty_error"));
      return;
    }
    setBusy(true);
    try {
      const res = await Voice.say({
        text: txt,
        provider: engine || undefined,
        style: style.trim() || undefined,
      });
      setLast(res);
      await play(res.audio_path);
    } catch (e) {
      toast.error((e as Error).message || t("voice_ui.test_synth_error"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label={t("voice_ui.test_engine_label")} hint={t("voice_ui.test_engine_hint")}>
          <UiSelect value={engine} onChange={setEngine} options={options} />
        </Field>
        <Field label={t("voice_ui.test_style_label")} hint={t("voice_ui.test_style_hint")}>
          <Input
            value={style}
            onChange={(e) => setStyle(e.target.value)}
            placeholder={t("voice_ui.style_ph")}
            data-testid="voice-test-style"
          />
        </Field>
      </div>
      <Field label={t("voice_ui.test_text_label")}>
        <Textarea
          rows={2}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={t("voice_ui.test_text_ph")}
          data-testid="voice-test-input"
        />
      </Field>
      <div className="flex items-center gap-2">
        <Button variant="primary" onClick={say} loading={busy} disabled={playLoading} data-testid="voice-test-say">
          <Volume2 className="size-4" /> {t("voice_ui.say_this")}
        </Button>
        {playing ? (
          <Button variant="secondary" onClick={stop} data-testid="voice-test-stop">
            <Square className="size-4" /> {t("voice_ui.stop")}
          </Button>
        ) : last ? (
          <Button variant="secondary" onClick={() => play(last.audio_path)} loading={playLoading} data-testid="voice-test-replay">
            <Play className="size-4" /> {t("voice_ui.replay")}
          </Button>
        ) : null}
        {last && (
          <span className="text-xs text-muted-fg">
            {t("voice_ui.engine_result")}: <strong>{last.provider}</strong>
            {last.duration_s ? ` · ${last.duration_s.toFixed(1)}s` : ""}
          </span>
        )}
      </div>
    </div>
  );
}
