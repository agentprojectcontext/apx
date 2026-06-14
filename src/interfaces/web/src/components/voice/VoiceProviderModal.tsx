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
import { t } from "../../i18n";

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
  const keyPlaceholder = existingKey ? t("voice_ui.api_key_set", { suffix: secretSuffix((config as { api_key?: unknown })?.api_key) ?? "" }) : t("voice_ui.api_key_label");

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
      setError((e as Error).message || t("voice_ui.err_save"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={t("voice_screen.configure_provider", { name: meta?.name || providerId || "" })}
      description={meta?.note}
      size="md"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>{t("common.cancel")}</Button>
          <Button variant="primary" onClick={submit} loading={busy} data-testid="voice-provider-save">{t("common.save")}</Button>
        </>
      }
    >
      <div className="space-y-3">
        {providerId === "piper" && (
          <>
            <Field label={t("voice_ui.piper_bin_label")} hint={t("voice_ui.piper_bin_hint")}>
              <Input value={f.bin} onChange={(e) => up({ bin: e.target.value })} placeholder="piper" />
            </Field>
            <Field label={t("voice_ui.piper_model_label")} hint={t("voice_ui.piper_model_hint")}>
              <Input value={f.model} onChange={(e) => up({ model: e.target.value })} placeholder="/abs/path/voice.onnx" />
            </Field>
            <Field label={t("voice_ui.piper_speaker_label")} hint={t("voice_ui.piper_speaker_hint")}>
              <Input value={f.speaker} onChange={(e) => up({ speaker: e.target.value })} placeholder="0" />
            </Field>
          </>
        )}

        {providerId === "elevenlabs" && (
          <>
            <Field label={t("voice_ui.api_key_label")} hint={existingKey ? t("voice_ui.api_key_keep_hint") : t("voice_ui.api_key_secret_hint", { env: "ELEVENLABS_API_KEY" })}>
              <Input type="password" autoComplete="new-password" value={apiKey} onChange={(e) => setApiKey(e.target.value)} placeholder={keyPlaceholder} />
            </Field>
            <Field label={t("voice_ui.model_label")}>
              <UiSelect value={f.model || ""} onChange={(v) => up({ model: v })} options={ELEVENLABS_MODELS.map((m) => ({ value: m, label: m }))} placeholder="eleven_multilingual_v2" />
            </Field>
            <Field label={t("voice_ui.voice_id_label")} hint={t("voice_ui.voice_id_hint")}>
              <Input value={f.voice_id} onChange={(e) => up({ voice_id: e.target.value })} placeholder="EXAVITQu4vr4xnSDxMaL" />
            </Field>
            <Field label={t("voice_ui.output_format_label")}>
              <Input value={f.output_format} onChange={(e) => up({ output_format: e.target.value })} placeholder="mp3_44100_128" />
            </Field>
          </>
        )}

        {providerId === "openai" && (
          <>
            <Field label={t("voice_ui.api_key_label")} hint={existingKey ? t("voice_ui.api_key_keep_hint") : t("voice_ui.api_key_reuse_hint", { engine: "engines.openai.api_key", env: "OPENAI_API_KEY" })}>
              <Input type="password" autoComplete="new-password" value={apiKey} onChange={(e) => setApiKey(e.target.value)} placeholder={keyPlaceholder} />
            </Field>
            <Field label={t("voice_ui.model_label")}>
              <UiSelect value={f.model || "tts-1"} onChange={(v) => up({ model: v })} options={OPENAI_TTS_MODELS.map((m) => ({ value: m, label: m }))} />
            </Field>
            <Field label={t("voice_ui.voice_label")}>
              <UiSelect value={f.voice || "alloy"} onChange={(v) => up({ voice: v })} options={OPENAI_TTS_VOICES.map((m) => ({ value: m, label: m }))} />
            </Field>
            <Field label={t("voice_ui.format_label")}>
              <UiSelect value={f.format || "mp3"} onChange={(v) => up({ format: v })} options={["mp3", "opus", "aac", "flac", "wav"].map((m) => ({ value: m, label: m }))} />
            </Field>
          </>
        )}

        {providerId === "gemini" && (
          <>
            <Field label={t("voice_ui.api_key_label")} hint={existingKey ? t("voice_ui.api_key_keep_hint") : t("voice_ui.api_key_reuse_hint", { engine: "engines.gemini.api_key", env: "GEMINI_API_KEY" })}>
              <Input type="password" autoComplete="new-password" value={apiKey} onChange={(e) => setApiKey(e.target.value)} placeholder={keyPlaceholder} />
            </Field>
            <Field label={t("voice_ui.model_label")} hint={t("voice_ui.gemini_model_hint")}>
              <Input value={f.model} onChange={(e) => up({ model: e.target.value })} placeholder="gemini-2.5-flash-preview-tts" />
            </Field>
            <Field label={t("voice_ui.voice_label")}>
              <UiSelect value={f.voice || "Kore"} onChange={(v) => up({ voice: v })} options={GEMINI_TTS_VOICES.map((m) => ({ value: m, label: m }))} />
            </Field>
            <Field label={t("voice_ui.style_label")} hint={t("voice_ui.style_hint")}>
              <Textarea rows={2} value={f.style || ""} onChange={(e) => up({ style: e.target.value })} placeholder={t("voice_ui.style_ph")} />
            </Field>
          </>
        )}

        {providerId === "mock" && (
          <p className="text-sm text-muted-fg">
            {t("voice_ui.mock_desc")}
          </p>
        )}

        {error && <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">{error}</div>}
      </div>
    </Dialog>
  );
}
