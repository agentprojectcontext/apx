import { useEffect, useState } from "react";
import { Button, Field, Input } from "../ui";
import { UiSelect } from "../UiSelect";
import { IMAGE_FORMATS, IMAGE_SIZE_PRESETS, type ImagesConfig } from "../../lib/api/images";
import { t } from "../../i18n";

// Shared defaults (images.defaults) — the bottom layer under every call.
// An engine's own block overrides these, and an explicit argument overrides
// both, so what is set here is "what I usually want", not "what every picture
// must be".

interface Props {
  config: ImagesConfig;
  onPatch: (set: Record<string, unknown>, unset?: string[]) => Promise<void>;
}

export function ImageDefaultsCard({ config, onPatch }: Props) {
  const d = config.defaults || {};
  const [size, setSize] = useState("");
  const [format, setFormat] = useState("");
  const [negative, setNegative] = useState("");
  const [count, setCount] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setSize(d.size || (d.width && d.height ? `${d.width}x${d.height}` : ""));
    setFormat(d.format || "");
    setNegative(d.negative_prompt || "");
    setCount(d.count != null ? String(d.count) : "");
    // The config object is replaced wholesale on every save, so keying on the
    // resolved primitives keeps this from looping.
  }, [d.size, d.width, d.height, d.format, d.negative_prompt, d.count]);

  const save = async () => {
    setBusy(true);
    try {
      const set: Record<string, unknown> = {};
      const unset: string[] = [];
      const text = (key: string, val: string) => {
        if (val.trim()) set[`images.defaults.${key}`] = val.trim();
        else unset.push(`images.defaults.${key}`);
      };
      // A size supersedes any stored width/height pair — keeping both would
      // leave two answers to the same question.
      if (size.trim()) {
        set["images.defaults.size"] = size.trim();
        unset.push("images.defaults.width", "images.defaults.height");
      } else {
        unset.push("images.defaults.size");
      }
      text("format", format);
      text("negative_prompt", negative);
      const n = Number(count);
      if (count.trim() && Number.isFinite(n)) set["images.defaults.count"] = n;
      else unset.push("images.defaults.count");
      await onPatch(set, unset);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-3" data-testid="image-defaults-card">
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label={t("images_ui.size_label")} hint={t("images_ui.default_size_hint")}>
          <UiSelect
            value={size}
            onChange={setSize}
            options={[{ value: "", label: t("images_ui.engine_default") },
              ...IMAGE_SIZE_PRESETS.map((s) => ({ value: s, label: s }))]}
          />
        </Field>
        <Field label={t("images_ui.format_label")} hint={t("images_ui.format_hint")}>
          <UiSelect
            value={format}
            onChange={setFormat}
            options={[{ value: "", label: t("images_ui.engine_default") },
              ...IMAGE_FORMATS.map((s) => ({ value: s, label: s }))]}
          />
        </Field>
      </div>
      <Field label={t("images_ui.negative_label")} hint={t("images_ui.negative_hint")}>
        <Input value={negative} onChange={(e) => setNegative(e.target.value)} placeholder={t("images_ui.negative_ph")} />
      </Field>
      <Field label={t("images_ui.count_label")} hint={t("images_ui.count_hint")}>
        <Input value={count} onChange={(e) => setCount(e.target.value)} inputMode="numeric" placeholder="1" />
      </Field>
      <Button variant="primary" onClick={save} loading={busy} data-testid="image-defaults-save">
        {t("common.save")}
      </Button>
    </div>
  );
}
