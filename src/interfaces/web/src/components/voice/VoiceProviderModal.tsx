import { useEffect, useState } from "react";
import { Button, Dialog, Field, Input, Textarea } from "../ui";
import { UiSelect } from "../UiSelect";
import { isSecretMarker, secretSuffix } from "../../lib/secrets";
import {
  ELEVENLABS_MODELS,
  GEMINI_TTS_VOICES,
  OPENAI_TTS_MODELS,
  OPENAI_TTS_VOICES,
  TTS_PROVIDER_META,
  type ElevenLabsConfig,
  type GeminiTtsConfig,
  type OpenAiTtsConfig,
  type PiperConfig,
} from "../../lib/api/voice";

// Per-provider settings. Saved as dotted-key patches under voice.tts.<id>.
// Secrets (api_key) follow the EnginesPanel convention: a blank field keeps
// the stored secret; the daemon ignores "*** set ***" markers on PATCH.

export interface VoiceProviderSave {
  /** dotted keys to set, e.g. { "voice.tts.openai.model": "tts-1-hd" } */
  set: Record<string, unknown>;
  /** dotted keys to clear */
  unset: string[];
}

interface Props {
  open: boolean;
  providerId: string | null; // piper | elevenlabs | openai | gemini | mock
  /** Current voice.tts.<id> block (may carry redacted secret markers). */
  config: Record<string, unknown>;
  onClose: () => void;
  onSave: (r: VoiceProviderSave) => Promise<void>;
}

function str(v: unknown): string {
  return typeof v === "string" ? v : v == null ? "" : String(v);
}

export function VoiceProviderModal({ open, providerId, config, onClose, onSave }: Props) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Field state (the api_key field is always blank on open — typing replaces).
  const [apiKey, setApiKey] = useState("");
  const [f, setF] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!open || !providerId) return;
    setError(null);
    setApiKey("");
    const c = config || {};
    if (providerId === "piper") {
      const p = c as PiperConfig;
      setF({ bin: str(p.bin), model: str(p.model), speaker: str(p.speaker) });
    } else if (providerId === "elevenlabs") {
      const p = c as ElevenLabsConfig;
      setF({ model: str(p.model), voice_id: str(p.voice_id), output_format: str(p.output_format) });
    } else if (providerId === "openai") {
      const p = c as OpenAiTtsConfig;
      setF({ model: str(p.model) || "tts-1", voice: str(p.voice) || "alloy", format: str(p.format) || "mp3" });
    } else if (providerId === "gemini") {
      const p = c as GeminiTtsConfig;
      setF({ model: str(p.model), voice: str(p.voice) || "Kore", style: str(p.style) });
    } else {
      setF({});
    }
  }, [open, providerId, config]);

  if (!providerId) return null;

  const meta = TTS_PROVIDER_META[providerId];
  const base = `voice.tts.${providerId}`;
  const up = (patch: Record<string, string>) => setF((s) => ({ ...s, ...patch }));

  const hasSecret = providerId !== "piper" && providerId !== "mock";
  const existingKey = hasSecret && isSecretMarker((config as { api_key?: unknown })?.api_key);
  const keyPlaceholder = existingKey ? `…${secretSuffix((config as { api_key?: unknown })?.api_key) ?? ""} (ya seteada)` : "API key";

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const set: Record<string, unknown> = {};
      const unset: string[] = [];
      const opt = (key: string, val: string) => {
        if (val.trim()) set[`${base}.${key}`] = val.trim();
        else unset.push(`${base}.${key}`);
      };

      if (providerId === "piper") {
        opt("bin", f.bin);
        opt("model", f.model);
        if (f.speaker.trim()) set[`${base}.speaker`] = f.speaker.trim();
        else unset.push(`${base}.speaker`);
      } else if (providerId === "elevenlabs") {
        opt("model", f.model);
        opt("voice_id", f.voice_id);
        opt("output_format", f.output_format);
      } else if (providerId === "openai") {
        opt("model", f.model);
        opt("voice", f.voice);
        opt("format", f.format);
      } else if (providerId === "gemini") {
        opt("model", f.model);
        opt("voice", f.voice);
        opt("style", f.style);
      }

      // Only push a key the user actually typed (blank keeps the stored one).
      if (hasSecret && apiKey.trim()) set[`${base}.api_key`] = apiKey.trim();

      await onSave({ set, unset });
      onClose();
    } catch (e) {
      setError((e as Error).message || "Error al guardar.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={`Configurar ${meta?.name || providerId}`}
      description={meta?.note}
      size="md"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>Cancelar</Button>
          <Button variant="primary" onClick={submit} loading={busy} data-testid="voice-provider-save">Guardar</Button>
        </>
      }
    >
      <div className="space-y-3">
        {providerId === "piper" && (
          <>
            <Field label="Binario (bin)" hint="Ruta o nombre del CLI piper (PATH).">
              <Input value={f.bin} onChange={(e) => up({ bin: e.target.value })} placeholder="piper" />
            </Field>
            <Field label="Modelo (.onnx)" hint="Ruta absoluta al modelo de voz piper.">
              <Input value={f.model} onChange={(e) => up({ model: e.target.value })} placeholder="/abs/path/voz.onnx" />
            </Field>
            <Field label="Speaker (opcional)" hint="Id de hablante para modelos multi-voz.">
              <Input value={f.speaker} onChange={(e) => up({ speaker: e.target.value })} placeholder="0" />
            </Field>
          </>
        )}

        {providerId === "elevenlabs" && (
          <>
            <Field label="API key" hint={existingKey ? "Dejá en blanco para mantener la actual." : "Se guarda como secreto. Env: ELEVENLABS_API_KEY"}>
              <Input type="password" autoComplete="new-password" value={apiKey} onChange={(e) => setApiKey(e.target.value)} placeholder={keyPlaceholder} />
            </Field>
            <Field label="Modelo">
              <UiSelect value={f.model || ""} onChange={(v) => up({ model: v })} options={ELEVENLABS_MODELS.map((m) => ({ value: m, label: m }))} placeholder="eleven_multilingual_v2" />
            </Field>
            <Field label="Voice ID" hint="Id de la voz de ElevenLabs (vacío = default).">
              <Input value={f.voice_id} onChange={(e) => up({ voice_id: e.target.value })} placeholder="EXAVITQu4vr4xnSDxMaL" />
            </Field>
            <Field label="Formato de salida">
              <Input value={f.output_format} onChange={(e) => up({ output_format: e.target.value })} placeholder="mp3_44100_128" />
            </Field>
          </>
        )}

        {providerId === "openai" && (
          <>
            <Field label="API key" hint={existingKey ? "Dejá en blanco para mantener la actual." : "Se reusa engines.openai.api_key si la dejás en blanco. Env: OPENAI_API_KEY"}>
              <Input type="password" autoComplete="new-password" value={apiKey} onChange={(e) => setApiKey(e.target.value)} placeholder={keyPlaceholder} />
            </Field>
            <Field label="Modelo">
              <UiSelect value={f.model || "tts-1"} onChange={(v) => up({ model: v })} options={OPENAI_TTS_MODELS.map((m) => ({ value: m, label: m }))} />
            </Field>
            <Field label="Voz">
              <UiSelect value={f.voice || "alloy"} onChange={(v) => up({ voice: v })} options={OPENAI_TTS_VOICES.map((m) => ({ value: m, label: m }))} />
            </Field>
            <Field label="Formato">
              <UiSelect value={f.format || "mp3"} onChange={(v) => up({ format: v })} options={["mp3", "opus", "aac", "flac", "wav"].map((m) => ({ value: m, label: m }))} />
            </Field>
          </>
        )}

        {providerId === "gemini" && (
          <>
            <Field label="API key" hint={existingKey ? "Dejá en blanco para mantener la actual." : "Se reusa engines.gemini.api_key si la dejás en blanco. Env: GEMINI_API_KEY"}>
              <Input type="password" autoComplete="new-password" value={apiKey} onChange={(e) => setApiKey(e.target.value)} placeholder={keyPlaceholder} />
            </Field>
            <Field label="Modelo" hint="TTS de Gemini sigue en preview.">
              <Input value={f.model} onChange={(e) => up({ model: e.target.value })} placeholder="gemini-2.5-flash-preview-tts" />
            </Field>
            <Field label="Voz">
              <UiSelect value={f.voice || "Kore"} onChange={(v) => up({ voice: v })} options={GEMINI_TTS_VOICES.map((m) => ({ value: m, label: m }))} />
            </Field>
            <Field label="Estilo (cómo querés que hable)" hint="Instrucción en lenguaje natural. Vacío = sin estilo. Ej: 'hablá en tono alegre y pausado'.">
              <Textarea rows={2} value={f.style || ""} onChange={(e) => up({ style: e.target.value })} placeholder="hablá en tono alegre y enérgico" />
            </Field>
          </>
        )}

        {providerId === "mock" && (
          <p className="text-sm text-muted-fg">
            El motor <strong>mock</strong> genera un WAV silencioso de prueba. No tiene parámetros: sirve como fallback garantizado cuando no hay otro motor configurado.
          </p>
        )}

        {error && <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">{error}</div>}
      </div>
    </Dialog>
  );
}
