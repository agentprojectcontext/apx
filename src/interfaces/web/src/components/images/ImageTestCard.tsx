import { useEffect, useRef, useState } from "react";
import { Download, ImageIcon, Wand2 } from "lucide-react";
import { Button, Field, Input, Textarea } from "../ui";
import { UiSelect } from "../UiSelect";
import {
  Images,
  fetchImageBlobUrl,
  IMAGE_SIZE_PRESETS,
  type ImageEngineInfo,
  type ImageGenerateResult,
} from "../../lib/api/images";
import { t } from "../../i18n";

// Draw one picture with the current routing, right here. Two jobs:
//   1. prove an endpoint actually works before anyone depends on it, and
//   2. show what the chosen engine could NOT honor — the same "ignored"
//      report the CLI prints, because a silently dropped `steps` is the
//      difference between "this looks wrong" and "that engine has no steps".

interface Props {
  engines: ImageEngineInfo[];
  defaultProvider: string;
  mode: string;
}

export function ImageTestCard({ engines, defaultProvider, mode }: Props) {
  const [prompt, setPrompt] = useState("");
  const [provider, setProvider] = useState("");
  const [size, setSize] = useState("");
  const [steps, setSteps] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ImageGenerateResult | null>(null);
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  // Blob URLs leak until revoked; one ref keeps exactly one alive at a time.
  const lastBlob = useRef<string | null>(null);

  useEffect(() => () => { if (lastBlob.current) URL.revokeObjectURL(lastBlob.current); }, []);

  const providerOptions = [
    { value: "", label: mode === "single" ? t("images_ui.test_routed_single", { id: defaultProvider }) : t("images_ui.test_routed_chain") },
    ...engines.map((e) => ({ value: e.id, label: e.custom ? e.label || e.id : e.id })),
  ];

  const run = async () => {
    if (!prompt.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const body: Parameters<typeof Images.generate>[0] = { prompt: prompt.trim() };
      if (provider) body.provider = provider;
      if (size) body.size = size;
      if (steps.trim() && Number.isFinite(Number(steps))) body.steps = Number(steps);
      const res = await Images.generate(body);
      setResult(res);
      const url = await fetchImageBlobUrl(res.images[0].path);
      if (lastBlob.current) URL.revokeObjectURL(lastBlob.current);
      lastBlob.current = url;
      setBlobUrl(url);
    } catch (e) {
      setError((e as Error).message);
      setResult(null);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-3" data-testid="image-test-card">
      <Field label={t("images_ui.prompt_label")}>
        <Textarea
          rows={2}
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder={t("images_ui.prompt_ph")}
          data-testid="image-test-prompt"
        />
      </Field>

      <div className="grid gap-3 sm:grid-cols-3">
        <Field label={t("images_ui.engine_label")}>
          <UiSelect value={provider} onChange={setProvider} options={providerOptions} />
        </Field>
        <Field label={t("images_ui.size_label")}>
          <UiSelect
            value={size}
            onChange={setSize}
            options={[{ value: "", label: t("images_ui.configured_default") },
              ...IMAGE_SIZE_PRESETS.map((s) => ({ value: s, label: s }))]}
          />
        </Field>
        <Field label={t("images_ui.steps_label")}>
          <Input value={steps} onChange={(e) => setSteps(e.target.value)} inputMode="numeric" placeholder={t("images_ui.configured_default")} />
        </Field>
      </div>

      <Button
        variant="primary"
        onClick={run}
        loading={busy}
        disabled={!prompt.trim()}
        data-testid="image-test-run"
      >
        <Wand2 className="size-3.5" /> {t("images_ui.generate")}
      </Button>

      {error && (
        <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
          {error}
        </div>
      )}

      {result && blobUrl && (
        <div className="space-y-2" data-testid="image-test-result">
          <img
            src={blobUrl}
            alt={result.prompt}
            className="max-h-80 w-full rounded-lg border border-border object-contain"
          />
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-fg">
            <span className="inline-flex items-center gap-1">
              <ImageIcon className="size-3" />
              {result.provider}{result.model ? ` · ${result.model}` : ""}
            </span>
            <span>{result.request.width}x{result.request.height}</span>
            {result.images[0]?.seed != null && <span>{t("images_ui.seed_is", { seed: String(result.images[0].seed) })}</span>}
            <span>{(result.elapsed_ms / 1000).toFixed(1)}s</span>
            <a href={blobUrl} download={`apx-${result.provider}.${result.images[0].format}`} className="inline-flex items-center gap-1 hover:text-fg">
              <Download className="size-3" /> {t("images_ui.download")}
            </a>
          </div>
          {result.ignored.length > 0 && (
            <div className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs">
              {t("images_ui.ignored_note", { provider: result.provider, options: result.ignored.join(", ") })}
            </div>
          )}
          <p className="truncate text-xs text-muted-fg" title={result.images[0].path}>{result.images[0].path}</p>
        </div>
      )}
    </div>
  );
}
