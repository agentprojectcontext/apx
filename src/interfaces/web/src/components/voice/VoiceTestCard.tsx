import { useState } from "react";
import { Play, Square, Volume2 } from "lucide-react";
import { Button, Field, Input, Textarea } from "../ui";
import { UiSelect } from "../UiSelect";
import { useToast } from "../Toast";
import { useTtsPlayer } from "./useTtsPlayer";
import { Voice, TTS_PROVIDER_META, type TtsEngineInfo, type TtsMode, type TtsSayResult } from "../../lib/api/voice";

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
  const [text, setText] = useState("Hola, soy APX. Esto es una prueba de voz.");
  // "" = use the saved default; otherwise force a specific engine.
  const [engine, setEngine] = useState("");
  const [style, setStyle] = useState("");
  const [busy, setBusy] = useState(false);
  const [last, setLast] = useState<TtsSayResult | null>(null);

  const defaultLabel =
    mode === "single" && defaultProvider && defaultProvider !== "auto"
      ? `Por defecto (${TTS_PROVIDER_META[defaultProvider]?.name || defaultProvider})`
      : "Por defecto (cadena)";

  const options = [
    { value: "", label: defaultLabel },
    ...engines.map((e) => ({
      value: e.id,
      label: `${TTS_PROVIDER_META[e.id]?.name || e.id}${e.available ? "" : " · no disponible"}`,
    })),
  ];

  const say = async () => {
    const t = text.trim();
    if (!t) {
      toast.error("Escribí algo para decir.");
      return;
    }
    setBusy(true);
    try {
      const res = await Voice.say({
        text: t,
        provider: engine || undefined,
        style: style.trim() || undefined,
      });
      setLast(res);
      await play(res.audio_path);
    } catch (e) {
      toast.error((e as Error).message || "No se pudo sintetizar.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Motor" hint="Override del por defecto para probar.">
          <UiSelect value={engine} onChange={setEngine} options={options} />
        </Field>
        <Field label="Estilo (solo Gemini)" hint="Cómo querés que hable. Vacío = sin estilo.">
          <Input
            value={style}
            onChange={(e) => setStyle(e.target.value)}
            placeholder="hablá en tono alegre y enérgico"
            data-testid="voice-test-style"
          />
        </Field>
      </div>
      <Field label="Texto a decir">
        <Textarea
          rows={2}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Escribí lo que querés que diga…"
          data-testid="voice-test-input"
        />
      </Field>
      <div className="flex items-center gap-2">
        <Button variant="primary" onClick={say} loading={busy} disabled={playLoading} data-testid="voice-test-say">
          <Volume2 className="size-4" /> Decir esto
        </Button>
        {playing ? (
          <Button variant="secondary" onClick={stop} data-testid="voice-test-stop">
            <Square className="size-4" /> Parar
          </Button>
        ) : last ? (
          <Button variant="secondary" onClick={() => play(last.audio_path)} loading={playLoading} data-testid="voice-test-replay">
            <Play className="size-4" /> Repetir
          </Button>
        ) : null}
        {last && (
          <span className="text-xs text-muted-fg">
            Motor: <strong>{last.provider}</strong>
            {last.duration_s ? ` · ${last.duration_s.toFixed(1)}s` : ""}
          </span>
        )}
      </div>
    </div>
  );
}
