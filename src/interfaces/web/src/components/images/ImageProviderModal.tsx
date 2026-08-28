import { useEffect, useState } from "react";
import { Button, Dialog, Field, Input } from "../ui";
import { UiSelect } from "../UiSelect";
import { isSecretMarker, secretSuffix } from "../../lib/secrets";
import {
  IMAGE_CUSTOM_KINDS,
  IMAGE_PROVIDER_META,
  type ImageCustomKind,
  type ImageEngineConfig,
} from "../../lib/api/images";
import { t } from "../../i18n";

// Per-engine settings, saved as dotted-key patches under images.<id> (or
// images.custom.<slug>). Secrets follow the house convention: a blank field
// keeps the stored key and the daemon ignores "*** set ***" markers on PATCH.
//
// Two things are per-engine rather than global on purpose:
//   • base_url — the whole point of the screen, and the only field a local
//     server on this Mac needs.
//   • defaults (steps / cfg) — a turbo checkpoint wants ~8 steps at cfg 1
//     while a standard one wants 20 at cfg 7, and that belongs to the SERVER,
//     not to the person typing a prompt.

export interface ImageProviderSave {
  set: Record<string, unknown>;
  unset: string[];
}

interface Props {
  open: boolean;
  providerId: string | null; // a1111 | sdcpp | openai | mock | custom:<slug> | __new__
  config: Record<string, unknown>;
  onClose: () => void;
  onSave: (r: ImageProviderSave) => Promise<void>;
}

function str(v: unknown): string {
  return typeof v === "string" ? v : v == null ? "" : String(v);
}

function slugify(label: string): string {
  return label
    .toLowerCase()
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
}

export function ImageProviderModal({ open, providerId, config, onClose, onSave }: Props) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [apiKey, setApiKey] = useState("");
  const [kind, setKind] = useState<ImageCustomKind>("a1111");
  const [f, setF] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!open || !providerId) return;
    setError(null);
    setApiKey("");
    const c = (config || {}) as ImageEngineConfig;
    const d = c.defaults || {};
    setKind((c.kind as ImageCustomKind) || "a1111");
    setF({
      label: str(c.label),
      base_url: str(c.base_url),
      model: str(c.model),
      timeout_s: str(c.timeout_s),
      quality: str(c.quality),
      d_size: d.size ? str(d.size) : (d.width && d.height ? `${d.width}x${d.height}` : ""),
      d_steps: str(d.steps),
      d_cfg_scale: str(d.cfg_scale),
      d_sampler: str(d.sampler),
      d_scheduler: str(d.scheduler),
    });
  }, [open, providerId, config]);

  if (!providerId) return null;

  const isCreate = providerId === "__new__";
  const isCustom = isCreate || providerId.startsWith("custom:");
  const meta = IMAGE_PROVIDER_META[providerId];
  const effectiveKind: ImageCustomKind = isCustom ? kind : (providerId as ImageCustomKind);
  const up = (patch: Record<string, string>) => setF((s) => ({ ...s, ...patch }));

  // The OpenAI dialect has no sampling knobs at all — hiding them beats
  // offering fields that would be accepted and then ignored.
  const hasSamplingKnobs = effectiveKind !== "openai";
  const hasBaseUrl = providerId !== "mock";
  const hasSecret = providerId !== "mock";
  const existingKey = hasSecret && isSecretMarker((config as { api_key?: unknown })?.api_key);
  const keyPlaceholder = existingKey
    ? t("images_ui.api_key_set", { suffix: secretSuffix((config as { api_key?: unknown })?.api_key) ?? "" })
    : t("images_ui.api_key_label");

  const title = isCreate
    ? t("images_ui.new_provider")
    : isCustom ? (f.label || providerId.slice(7)) : meta?.name || providerId;

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const slug = isCreate ? slugify(f.label) : isCustom ? providerId.slice(7) : "";
      if (isCustom) {
        if (!f.label.trim() || !slug) throw new Error(t("images_ui.err_label_required"));
        if (!f.base_url.trim()) throw new Error(t("images_ui.err_base_url_required"));
      }
      const base = isCustom ? `images.custom.${slug}` : `images.${providerId}`;

      const set: Record<string, unknown> = {};
      const unset: string[] = [];
      const optText = (key: string, val: string) => {
        if (val.trim()) set[`${base}.${key}`] = val.trim();
        else unset.push(`${base}.${key}`);
      };
      const optNum = (key: string, val: string) => {
        const n = Number(val);
        if (val.trim() && Number.isFinite(n)) set[`${base}.${key}`] = n;
        else unset.push(`${base}.${key}`);
      };

      if (isCustom) {
        set[`${base}.label`] = f.label.trim();
        set[`${base}.kind`] = kind;
      }
      if (hasBaseUrl) optText("base_url", f.base_url);
      optText("model", f.model);
      optNum("timeout_s", f.timeout_s);
      if (effectiveKind === "openai") optText("quality", f.quality);

      // Per-engine defaults. Kept as a nested block so a call, the global
      // defaults and the engine's own can all be told apart.
      optText("defaults.size", f.d_size);
      if (hasSamplingKnobs) {
        optNum("defaults.steps", f.d_steps);
        optNum("defaults.cfg_scale", f.d_cfg_scale);
        optText("defaults.sampler", f.d_sampler);
        optText("defaults.scheduler", f.d_scheduler);
      }

      if (hasSecret && apiKey.trim()) set[`${base}.api_key`] = apiKey.trim();

      await onSave({ set, unset });
      onClose();
    } catch (e) {
      setError((e as Error).message || t("images_ui.err_save"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={t("images_screen.configure_provider", { name: title })}
      description={isCustom ? t("images_ui.custom_desc") : meta?.note}
      size="md"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>{t("common.cancel")}</Button>
          <Button variant="primary" onClick={submit} loading={busy} data-testid="image-provider-save">
            {t("common.save")}
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        {providerId === "mock" ? (
          <p className="text-sm text-muted-fg">{t("images_ui.mock_desc")}</p>
        ) : (
          <>
            {isCustom && (
              <>
                <Field label={t("images_ui.label_label")} hint={t("images_ui.label_hint")}>
                  <Input value={f.label} onChange={(e) => up({ label: e.target.value })} placeholder="Homelab" />
                </Field>
                <Field label={t("images_ui.kind_label")} hint={t("images_ui.kind_hint")}>
                  <UiSelect
                    value={kind}
                    onChange={(v) => setKind(v as ImageCustomKind)}
                    options={IMAGE_CUSTOM_KINDS.map((k) => ({ value: k, label: IMAGE_PROVIDER_META[k]?.name || k }))}
                  />
                </Field>
              </>
            )}

            <Field
              label={isCustom ? t("images_ui.base_url_req_label") : t("images_ui.base_url_label")}
              hint={effectiveKind === "openai" ? t("images_ui.base_url_openai_hint") : t("images_ui.base_url_hint")}
            >
              <Input
                value={f.base_url}
                onChange={(e) => up({ base_url: e.target.value })}
                placeholder={effectiveKind === "openai" ? "http://127.0.0.1:8189/v1" : "http://127.0.0.1:7860"}
                data-testid="image-provider-base-url"
              />
            </Field>

            <Field
              label={t("images_ui.api_key_label")}
              hint={existingKey
                ? t("images_ui.api_key_keep_hint")
                : effectiveKind === "openai" && !f.base_url.trim()
                  ? t("images_ui.api_key_reuse_hint", { engine: "engines.openai.api_key", env: "OPENAI_API_KEY" })
                  : t("images_ui.api_key_optional_hint")}
            >
              <Input
                type="password"
                autoComplete="new-password"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder={keyPlaceholder}
              />
            </Field>

            <Field label={t("images_ui.model_label")} hint={t("images_ui.model_hint")}>
              <Input value={f.model} onChange={(e) => up({ model: e.target.value })} placeholder={t("images_ui.optional_ph")} />
            </Field>

            <div className="rounded-md border border-border/60 p-3 space-y-3">
              <p className="text-xs text-muted-fg">{t("images_ui.engine_defaults_hint")}</p>
              <Field label={t("images_ui.size_label")} hint={t("images_ui.size_hint")}>
                <Input value={f.d_size} onChange={(e) => up({ d_size: e.target.value })} placeholder="512x512" />
              </Field>
              {hasSamplingKnobs && (
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field label={t("images_ui.steps_label")} hint={t("images_ui.steps_hint")}>
                    <Input value={f.d_steps} onChange={(e) => up({ d_steps: e.target.value })} inputMode="numeric" placeholder="20" />
                  </Field>
                  <Field label={t("images_ui.cfg_label")} hint={t("images_ui.cfg_hint")}>
                    <Input value={f.d_cfg_scale} onChange={(e) => up({ d_cfg_scale: e.target.value })} inputMode="decimal" placeholder="7" />
                  </Field>
                  <Field label={t("images_ui.sampler_label")}>
                    <Input value={f.d_sampler} onChange={(e) => up({ d_sampler: e.target.value })} placeholder={t("images_ui.server_default_ph")} />
                  </Field>
                  <Field label={t("images_ui.scheduler_label")}>
                    <Input value={f.d_scheduler} onChange={(e) => up({ d_scheduler: e.target.value })} placeholder={t("images_ui.server_default_ph")} />
                  </Field>
                </div>
              )}
              {effectiveKind === "openai" && (
                <Field label={t("images_ui.quality_label")} hint={t("images_ui.quality_hint")}>
                  <Input value={f.quality} onChange={(e) => up({ quality: e.target.value })} placeholder={t("images_ui.optional_ph")} />
                </Field>
              )}
              <Field label={t("images_ui.timeout_label")} hint={t("images_ui.timeout_hint")}>
                <Input value={f.timeout_s} onChange={(e) => up({ timeout_s: e.target.value })} inputMode="numeric" placeholder="600" />
              </Field>
            </div>
          </>
        )}

        {error && (
          <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
            {error}
          </div>
        )}
      </div>
    </Dialog>
  );
}
