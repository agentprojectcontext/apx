import { useState } from "react";
import useSWR from "swr";
import { Database, Sparkles } from "lucide-react";
import { Section } from "../Section";
import { Button, Field, Input, Loading, Badge } from "../ui";
import { UiSelect } from "../UiSelect";
import { useToast } from "../Toast";
import { useGlobalConfig } from "../../hooks/useGlobalConfig";
import { Embeddings, type EmbedMode } from "../../lib/api/embeddings";
import { EmbedProviderList } from "./EmbedProviderList";
import { ModelPicker } from "../chat/ModelPicker";
import { t } from "../../i18n";

// Memory / RAG embeddings configuration. Mirrors the Voice (TTS/STT) panel:
// pick the provider + model for the cross-channel memory retriever. Persists
// under config.memory.embeddings.* via the admin config PATCH. Switching
// provider/model changes the embedder space, so a "Reindexar" action rebuilds
// the vector store under the new embedder.

const providerOptions = () => [
  { value: "auto", label: t("memory_panel.provider_auto") },
  { value: "ollama", label: t("memory_panel.provider_ollama") },
  { value: "gemini", label: t("memory_panel.provider_gemini") },
  { value: "openai", label: t("memory_panel.provider_openai") },
  { value: "tf", label: t("memory_panel.provider_tf") },
];

const modeOptions = () => [
  { value: "chain", label: t("memory_panel.mode_chain") },
  { value: "single", label: t("memory_panel.mode_single") },
];

interface MemoryCfg {
  embeddings?: {
    provider?: string;
    mode?: EmbedMode;
    ollama?: { model?: string; base_url?: string };
    openai?: { api_key?: string; model?: string; base_url?: string };
    gemini?: { api_key?: string; model?: string };
  };
  compact_threshold?: number;
  keep_recent?: number;
  compact_model?: string;
  compact_fallback_model?: string;
}

export function MemoryPanel() {
  const toast = useToast();
  const { config, isLoading, patch } = useGlobalConfig();
  const { data: providers, mutate: mutateProviders } = useSWR(
    "/api/embeddings/providers",
    () => Embeddings.providers()
  );
  const [busy, setBusy] = useState(false);
  const [testResult, setTestResult] = useState<string | null>(null);

  if (isLoading) return <Loading />;

  const mem = (config as unknown as { memory?: MemoryCfg }).memory || {};
  const emb = mem.embeddings || {};
  const provider = providers?.configured_provider || emb.provider || "auto";
  const mode: EmbedMode = providers?.mode || emb.mode || "chain";
  const engines = providers?.engines || [];
  const order = providers?.order || [];

  const apply = async (set: Record<string, unknown>) => {
    setBusy(true);
    try {
      await patch(set);
      await mutateProviders();
    } catch (e) {
      toast.error(t("memory_panel.save_failed", { msg: (e as Error).message }));
    } finally {
      setBusy(false);
    }
  };

  const runTest = async () => {
    setBusy(true);
    setTestResult(null);
    try {
      const r = await Embeddings.test({});
      setTestResult(`${r.embedder} · dim ${r.dim} · ${r.ms}ms`);
      toast.success(t("memory_panel.test_ok", { embedder: r.embedder }));
    } catch (e) {
      toast.error(t("memory_panel.test_failed", { msg: (e as Error).message }));
    } finally {
      setBusy(false);
    }
  };

  const runReindex = async () => {
    setBusy(true);
    try {
      const r = await Embeddings.reindex();
      toast.success(t("memory_panel.reindexed", { indexed: r.indexed, cleared: r.cleared }));
    } catch (e) {
      toast.error(t("memory_panel.reindex_failed", { msg: (e as Error).message }));
    } finally {
      setBusy(false);
    }
  };

  const models: Record<string, string> = {
    ollama: emb.ollama?.model || "",
    openai: emb.openai?.model || "",
    gemini: emb.gemini?.model || "",
  };

  return (
    <div className="grid gap-6 xl:grid-cols-2 xl:items-start">
      <Section
        title={t("memory_panel.embeddings_title")}
        description={t("memory_panel.embeddings_desc")}
      >
        <div className="space-y-3">
          <Field label={t("memory_panel.mode_label")} hint={t("memory_panel.mode_hint")}>
            <UiSelect
              value={mode}
              onChange={(v) => apply({ "memory.embeddings.mode": v })}
              options={modeOptions()}
              disabled={busy}
              className="max-w-md"
            />
          </Field>

          {mode === "chain" ? (
            // Ordered fallback chain — reorder, enable/disable, and pick each
            // engine's embedding model right here. Keys are reused from Engines &
            // models, so there is nothing to re-declare. The first AVAILABLE
            // engine wins, so with Ollama down the chain skips to the next one.
            <Field label={t("memory_panel.chain_label")} hint={t("memory_panel.chain_hint")}>
              <EmbedProviderList
                engines={engines}
                order={order}
                models={models}
                busy={busy}
                onReorder={(next) => apply({ "memory.embeddings.order": next })}
                onToggleEnabled={(id, enabled) =>
                  apply({ [`memory.embeddings.${id}.enabled`]: enabled })
                }
                onSetModel={(id, model) => apply({ [`memory.embeddings.${id}.model`]: model })}
              />
            </Field>
          ) : (
            <>
              <Field label={t("memory_panel.provider_label")} hint={t("memory_panel.provider_hint")}>
                <UiSelect
                  value={provider}
                  onChange={(v) => apply({ "memory.embeddings.provider": v })}
                  options={providerOptions()}
                  disabled={busy}
                  className="max-w-xl"
                />
              </Field>
              {provider !== "auto" && provider !== "tf" && (
                <Field label={t("memory_panel.model_label")}>
                  <Input
                    defaultValue={models[provider] || ""}
                    placeholder={t("memory_panel.model_ph")}
                    disabled={busy}
                    onBlur={(ev) => {
                      const v = ev.target.value.trim();
                      if (v !== (models[provider] || "")) apply({ [`memory.embeddings.${provider}.model`]: v });
                    }}
                    className="max-w-md font-mono text-sm"
                  />
                </Field>
              )}
            </>
          )}

          <p className="pt-1 text-xs text-muted-foreground">{t("memory_panel.keys_reuse_note")}</p>

          <div className="flex flex-wrap items-center gap-3 pt-1">
            <Button variant="secondary" onClick={runTest} loading={busy}>
              <Sparkles size={14} /> {t("memory_panel.test_btn")}
            </Button>
            <Button variant="secondary" onClick={runReindex} loading={busy}>
              <Database size={14} /> {t("memory_panel.reindex_btn")}
            </Button>
            {providers?.active_embedder && (
              <Badge tone={providers.active_embedder === "tf" ? "warning" : "success"}>
                {t("memory_panel.active_embedder", { embedder: providers.active_embedder })}
              </Badge>
            )}
            {testResult && <span className="text-sm text-muted-foreground">{testResult}</span>}
          </div>
        </div>
      </Section>

      <Section
        title={t("memory_panel.compaction_title")}
        description={t("memory_panel.compaction_desc")}
      >
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={t("memory_panel.threshold_label")} hint={t("memory_panel.threshold_hint")}>
            <Input
              type="number"
              min={1}
              defaultValue={mem.compact_threshold ?? 60}
              placeholder="60"
              disabled={busy}
              onBlur={(ev) => {
                const n = parseInt(ev.target.value, 10);
                if (Number.isFinite(n) && n > 0 && n !== mem.compact_threshold) {
                  apply({ "memory.compact_threshold": n });
                }
              }}
              className="max-w-[10rem]"
            />
          </Field>
          <Field label={t("memory_panel.keep_recent_label")} hint={t("memory_panel.keep_recent_hint")}>
            <Input
              type="number"
              min={1}
              defaultValue={mem.keep_recent ?? 40}
              placeholder="40"
              disabled={busy}
              onBlur={(ev) => {
                const n = parseInt(ev.target.value, 10);
                if (Number.isFinite(n) && n > 0 && n !== mem.keep_recent) {
                  apply({ "memory.keep_recent": n });
                }
              }}
              className="max-w-[10rem]"
            />
          </Field>
        </div>
        <Field label={t("memory_panel.compact_model_label")} hint={t("memory_panel.compact_model_hint")}>
          <div className="w-fit rounded-md border border-border px-2 py-1">
            <ModelPicker
              value={mem.compact_model || ""}
              onChange={(v) => apply({ "memory.compact_model": v })}
              disabled={busy}
            />
          </div>
        </Field>
        <Field label={t("memory_panel.compact_fallback_label")} hint={t("memory_panel.compact_fallback_hint")}>
          <div className="w-fit rounded-md border border-border px-2 py-1">
            <ModelPicker
              value={mem.compact_fallback_model || ""}
              onChange={(v) => apply({ "memory.compact_fallback_model": v })}
              disabled={busy}
            />
          </div>
        </Field>
      </Section>
    </div>
  );
}
