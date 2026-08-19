import { useEffect, useMemo, useState } from "react";
import { Loader2, Send, Zap } from "lucide-react";
import { Button, Dialog, Field, Textarea } from "../../ui";
import { ModelCombobox } from "../../ModelCombobox";
import { Engines, type EngineTestResult } from "../../../lib/api/engines";
import { useOllamaModels } from "../../../hooks/useOllamaModels";
import { ENGINE_PRESETS, type EngineType } from "./typeStyles";
import type { Provider } from "./types";
import { t } from "../../../i18n";
import { toneText } from "../../../lib/tone";

/** True when the gateway's echoed id is the same model we asked for. */
function servedMatchesRequested(requested: string, served: string | null | undefined): boolean {
  if (!served) return true;
  const a = requested.trim().toLowerCase();
  const b = served.trim().toLowerCase();
  if (!a || a === b) return true;
  const tail = b.split(/[/:]/).pop() || b;
  return tail === a;
}

// "Does this actually answer?" — one message, one reply, nothing kept.
//
// Deliberately not a chat: no history is sent or stored, so the reply costs a
// couple of hundred tokens and tells you the credentials, the endpoint and the
// model id all line up. Closing it throws the exchange away.
export function ProviderTestDialog({
  open,
  provider,
  onClose,
}: {
  open: boolean;
  provider: Provider | null;
  onClose: () => void;
}) {
  const [model, setModel] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<EngineTestResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const engine = (provider?.engine as EngineType) || "custom";
  const isOllama = engine === "ollama";

  // Ollama's catalog only exists on the machine running it.
  const ollamaTargets = useMemo(
    () => (isOllama && provider ? [{ slug: provider.slug, base_url: provider.base_url }] : []),
    [isOllama, provider],
  );
  const { models: ollamaModels } = useOllamaModels(ollamaTargets);

  const modelOptions = useMemo(() => {
    if (!provider) return [];
    if (isOllama) return ollamaModels[provider.slug] || [];
    const known = ENGINE_PRESETS[engine]?.known_models || [];
    return Array.from(new Set([...(provider.default_model ? [provider.default_model] : []), ...known]));
  }, [provider, engine, isOllama, ollamaModels]);

  // Every open starts clean — this is a probe, not a session.
  useEffect(() => {
    if (!open) return;
    setModel(provider?.default_model || "");
    setMessage(t("provider_test.default_message"));
    setResult(null);
    setError(null);
  }, [open, provider]);

  const send = async () => {
    if (!provider || !model.trim()) return;
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      setResult(await Engines.test({ provider: provider.slug, model: model.trim(), message: message.trim() }));
    } catch (e) {
      setError((e as Error).message);
    } finally { setBusy(false); }
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={t("provider_test.title", { name: provider?.name || provider?.slug || "" })}
      description={t("provider_test.description")}
      size="md"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>{t("common.close")}</Button>
          <Button variant="primary" onClick={send} loading={busy} disabled={!model.trim()}>
            <Send size={13} /> {t("provider_test.send")}
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <Field label={t("provider_test.model_label")} hint={t("provider_test.model_hint")}>
          <ModelCombobox
            value={model}
            onChange={setModel}
            options={modelOptions}
            emptyHint={isOllama ? t("router_panel.ollama_empty") : undefined}
          />
        </Field>

        <Field label={t("provider_test.message_label")}>
          <Textarea
            rows={2}
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            placeholder={t("provider_test.message_ph")}
            onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) send(); }}
          />
        </Field>

        {busy && (
          <div className="flex items-center gap-2 rounded-lg border border-border bg-muted/20 px-3 py-2 text-xs text-muted-fg">
            <Loader2 className="size-3.5 animate-spin" /> {t("provider_test.waiting")}
          </div>
        )}

        {error && (
          <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
            {error}
          </div>
        )}

        {result && (
          <div className="space-y-1.5 rounded-lg border border-emerald-500/30 bg-emerald-500/5 px-3 py-2">
            <div className="flex items-center gap-2 text-[11px] text-muted-fg">
              <Zap className={`size-3 ${toneText.emerald}`} />
              <span className="font-mono">{result.provider}:{result.model}</span>
              <span>· {result.ms} ms</span>
              {result.usage?.output_tokens !== undefined && (
                <span>· {t("provider_test.tokens", { n: String(result.usage.output_tokens) })}</span>
              )}
            </div>
            {result.served_model && !servedMatchesRequested(result.model, result.served_model) && (
              <div className={`text-[11px] font-mono ${toneText.amber}`}>
                {t("provider_test.served", { id: result.served_model })}
                <span> · {t("provider_test.served_mismatch")}</span>
              </div>
            )}
            <p className="whitespace-pre-wrap text-sm">{result.text || t("provider_test.empty_reply")}</p>
          </div>
        )}
      </div>
    </Dialog>
  );
}
