import { Field } from "../ui";
import { UiSelect } from "../UiSelect";
import { WHISPER_MODELS, type TranscriptionConfig } from "../../lib/api/voice";

// STT (speech-to-text) configuration. Persisted under config.transcription.
// The actual capture happens in the deck overlay / Telegram / CLI; here the
// owner just picks the backend + (for local whisper) the model + language.

interface Props {
  config: TranscriptionConfig;
  onPatch: (set: Record<string, unknown>, unset?: string[]) => void;
  busy?: boolean;
}

const PROVIDER_OPTIONS = [
  { value: "auto", label: "Automático (local, luego OpenAI)" },
  { value: "local", label: "Local — faster-whisper (offline)" },
  { value: "openai", label: "OpenAI — Whisper-1 (cloud)" },
];

const LANG_OPTIONS = [
  { value: "auto", label: "Auto-detectar" },
  { value: "es", label: "Español" },
  { value: "en", label: "Inglés" },
  { value: "pt", label: "Portugués" },
  { value: "fr", label: "Francés" },
  { value: "it", label: "Italiano" },
  { value: "de", label: "Alemán" },
];

export function VoiceSttCard({ config, onPatch, busy }: Props) {
  const provider = config.provider || "auto";
  const local = config.local || {};
  const model = local.model || "small";
  const language = local.language || "auto";
  const usesLocal = provider !== "openai";

  return (
    <div className="space-y-3">
      <Field label="Motor de transcripción" hint="Local usa faster-whisper (requiere python3 + faster-whisper). OpenAI usa la key de engines.openai.">
        <UiSelect
          value={provider}
          onChange={(v) => onPatch({ "transcription.provider": v })}
          options={PROVIDER_OPTIONS}
          disabled={busy}
          className="max-w-md"
        />
      </Field>

      {usesLocal && (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="Modelo local (whisper)" hint="Más grande = más preciso y más lento.">
            <UiSelect
              value={model}
              onChange={(v) => onPatch({ "transcription.local.model": v })}
              options={WHISPER_MODELS.map((m) => ({ value: m, label: m }))}
              disabled={busy}
            />
          </Field>
          <Field label="Idioma" hint='Para español, fijá "Español" mejora la precisión.'>
            <UiSelect
              value={language}
              onChange={(v) => onPatch({ "transcription.local.language": v })}
              options={LANG_OPTIONS}
              disabled={busy}
            />
          </Field>
        </div>
      )}
    </div>
  );
}
