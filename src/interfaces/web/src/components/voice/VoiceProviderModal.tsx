import { useEffect, useState } from "react";
import { Button, Dialog, Field, Input, Switch, Textarea } from "../ui";
import { UiSelect } from "../UiSelect";
import { isSecretMarker, secretSuffix } from "../../lib/secrets";
import {
  DEFAULT_EMOTION_TAGS,
  ELEVENLABS_MODELS,
  GEMINI_TTS_VOICES,
  OPENAI_TTS_MODELS,
  OPENAI_TTS_VOICES,
  TTS_PROVIDER_META,
  type CustomTtsConfig,
  type ElevenLabsConfig,
  type EmotionsConfig,
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

// Stable config slug from a display label (e.g. "My QVox 🎙" → "my-qvox").
function slugify(label: string): string {
  return label
    .toLowerCase()
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
}

// Generic inline-emotion-tags control. Enabling it makes the agent emit [tag]
// markers in voice mode; the daemon teaches the syntax only when this engine
// will speak, and strips stray tags when it won't (so they're never read aloud).
function EmotionsField({ on, setOn, tags, setTags }: {
  on: boolean; setOn: (v: boolean) => void; tags: string; setTags: (v: string) => void;
}) {
  return (
    <div className="rounded-md border border-border/60 p-3 space-y-2">
      <Switch checked={on} onChange={setOn} label={t("voice_ui.emotions_label")} />
      <p className="text-xs text-muted-fg">{t("voice_ui.emotions_hint")}</p>
      {on && (
        <Field label={t("voice_ui.emotions_tags_label")} hint={t("voice_ui.emotions_tags_hint")}>
          <Input value={tags} onChange={(e) => setTags(e.target.value)} placeholder={DEFAULT_EMOTION_TAGS.join(", ")} />
        </Field>
      )}
    </div>
  );
}

export function VoiceProviderModal({ open, providerId, config, onClose, onSave }: Props) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Field state (the api_key field is always blank on open — typing replaces).
  const [apiKey, setApiKey] = useState("");
  const [f, setF] = useState<Record<string, string>>({});
  // Generic emotion-tags capability (openai/gemini). Separate state because it
  // saves as nested keys, not flat strings.
  const [emoOn, setEmoOn] = useState(false);
  const [emoTags, setEmoTags] = useState("");
  const [showAdvanced, setShowAdvanced] = useState(false);

  useEffect(() => {
    if (!open || !providerId) return;
    setError(null);
    setApiKey("");
    const c = config || {};
    const emo = (c as { emotions?: EmotionsConfig }).emotions;
    setEmoOn(!!emo?.enabled);
    setEmoTags(Array.isArray(emo?.tags) ? emo!.tags!.join(", ") : "");
    setShowAdvanced(false);
    const customMode = providerId === "__new__" || providerId.startsWith("custom:");
    if (customMode) {
      const p = c as unknown as CustomTtsConfig;
      setF({
        label: str(p.label),
        base_url: str(p.base_url),
        model: str(p.model),
        voice: str(p.voice),
        format: str(p.format),
        style: str(p.style),
        temperature: str(p.temperature),
      });
    } else if (providerId === "piper") {
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

  const isCreate = providerId === "__new__";
  const isCustom = isCreate || providerId.startsWith("custom:");
  const meta = TTS_PROVIDER_META[providerId];
  const up = (patch: Record<string, string>) => setF((s) => ({ ...s, ...patch }));

  const hasSecret = providerId !== "piper" && providerId !== "mock";
  const existingKey = hasSecret && isSecretMarker((config as { api_key?: unknown })?.api_key);
  const keyPlaceholder = existingKey ? t("voice_ui.api_key_set", { suffix: secretSuffix((config as { api_key?: unknown })?.api_key) ?? "" }) : t("voice_ui.api_key_label");

  const title = isCreate
    ? t("voice_ui.new_provider")
    : isCustom
      ? (f.label || providerId.slice(7))
      : meta?.name || providerId;

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      // Resolve the config base. Custom providers live under
      // voice.tts.custom.<slug>; built-ins are flat voice.tts.<id>.
      const slug = isCreate ? slugify(f.label) : isCustom ? providerId.slice(7) : "";
      if (isCustom) {
        if (!f.label.trim()) throw new Error(t("voice_ui.err_label_required"));
        if (!f.base_url.trim()) throw new Error(t("voice_ui.err_base_url_required"));
        if (!slug) throw new Error(t("voice_ui.err_label_required"));
      }
      const base = isCustom ? `voice.tts.custom.${slug}` : `voice.tts.${providerId}`;

      const set: Record<string, unknown> = {};
      const unset: string[] = [];
      const opt = (key: string, val: string) => {
        if (val.trim()) set[`${base}.${key}`] = val.trim();
        else unset.push(`${base}.${key}`);
      };

      if (isCustom) {
        set[`${base}.label`] = f.label.trim();
        set[`${base}.base_url`] = f.base_url.trim();
        opt("style", f.style);
        if (f.temperature.trim() && !Number.isNaN(Number(f.temperature)))
          set[`${base}.temperature`] = Number(f.temperature);
        else unset.push(`${base}.temperature`);
        // Advanced (optional): model/voice for non-QVox OpenAI-compatible servers.
        opt("model", f.model);
        opt("voice", f.voice);
      } else if (providerId === "piper") {
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

      // Generic emotion-tags capability (engines that parse inline [tags]).
      if (isCustom || providerId === "gemini") {
        set[`${base}.emotions.enabled`] = emoOn;
        const tags = emoTags.split(",").map((t) => t.trim().toLowerCase()).filter(Boolean);
        if (tags.length) set[`${base}.emotions.tags`] = tags;
        else unset.push(`${base}.emotions.tags`);
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
      title={t("voice_screen.configure_provider", { name: title })}
      description={isCustom ? t("voice_ui.custom_desc") : meta?.note}
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

        {/* Built-in OpenAI (cloud only). */}
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

        {/* Custom OpenAI-compatible provider (e.g. a local QVox server). */}
        {isCustom && (
          <>
            <Field label={t("voice_ui.label_label")} hint={t("voice_ui.label_hint")}>
              <Input value={f.label} onChange={(e) => up({ label: e.target.value })} placeholder="QVox" />
            </Field>
            <Field label={t("voice_ui.base_url_req_label")} hint={t("voice_ui.base_url_req_hint")}>
              <Input value={f.base_url} onChange={(e) => up({ base_url: e.target.value })} placeholder="http://127.0.0.1:5111/v1" />
            </Field>
            <Field label={t("voice_ui.api_key_label")} hint={existingKey ? t("voice_ui.api_key_keep_hint") : t("voice_ui.api_key_optional_hint")}>
              <Input type="password" autoComplete="new-password" value={apiKey} onChange={(e) => setApiKey(e.target.value)} placeholder={keyPlaceholder} />
            </Field>
            <Field label={t("voice_ui.style_label")} hint={t("voice_ui.openai_style_hint")}>
              <Textarea rows={2} value={f.style || ""} onChange={(e) => up({ style: e.target.value })} placeholder={t("voice_ui.style_ph")} />
            </Field>
            <Field label={t("voice_ui.temperature_label")} hint={t("voice_ui.temperature_hint")}>
              <Input value={f.temperature} onChange={(e) => up({ temperature: e.target.value })} inputMode="decimal" placeholder="0.7" />
            </Field>
            <EmotionsField on={emoOn} setOn={setEmoOn} tags={emoTags} setTags={setEmoTags} />
            <div>
              <button
                type="button"
                onClick={() => setShowAdvanced((s) => !s)}
                className="text-xs text-muted-fg hover:text-fg"
              >
                {showAdvanced ? "▾ " : "▸ "}{t("voice_ui.advanced")}
              </button>
              {showAdvanced && (
                <div className="mt-2 space-y-3">
                  <Field label={t("voice_ui.model_label")} hint={t("voice_ui.custom_model_hint")}>
                    <Input value={f.model} onChange={(e) => up({ model: e.target.value })} placeholder={t("voice_ui.custom_optional_ph")} />
                  </Field>
                  <Field label={t("voice_ui.voice_label")} hint={t("voice_ui.custom_voice_hint")}>
                    <Input value={f.voice} onChange={(e) => up({ voice: e.target.value })} placeholder={t("voice_ui.custom_optional_ph")} />
                  </Field>
                </div>
              )}
            </div>
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
            <EmotionsField on={emoOn} setOn={setEmoOn} tags={emoTags} setTags={setEmoTags} />
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
