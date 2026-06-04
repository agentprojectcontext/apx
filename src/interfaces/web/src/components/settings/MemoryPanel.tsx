import { useState } from "react";
import useSWR from "swr";
import { Database, Sparkles } from "lucide-react";
import { Section } from "../Section";
import { Button, Field, Input, Loading, Badge } from "../ui";
import { UiSelect } from "../UiSelect";
import { useToast } from "../Toast";
import { useGlobalConfig } from "../../hooks/useGlobalConfig";
import { Embeddings, type EmbedMode } from "../../lib/api/embeddings";

// Memory / RAG embeddings configuration. Mirrors the Voice (TTS/STT) panel:
// pick the provider + model for the cross-channel memory retriever. Persists
// under config.memory.embeddings.* via the admin config PATCH. Switching
// provider/model changes the embedder space, so a "Reindexar" action rebuilds
// the vector store under the new embedder.

const PROVIDER_OPTIONS = [
  { value: "auto", label: "Automático (cadena: Ollama → Gemini → OpenAI → offline)" },
  { value: "ollama", label: "Ollama — local, sin API key (nomic-embed-text)" },
  { value: "gemini", label: "Gemini — free tier con key (text-embedding-004)" },
  { value: "openai", label: "OpenAI — text-embedding-3-small (cloud)" },
  { value: "tf", label: "Offline (term-frequency, sin modelo — degradado)" },
];

const MODE_OPTIONS = [
  { value: "chain", label: "Cadena (fallback automático)" },
  { value: "single", label: "Único (usa solo el elegido)" },
];

interface MemoryCfg {
  embeddings?: {
    provider?: string;
    mode?: EmbedMode;
    ollama?: { model?: string; base_url?: string };
    openai?: { api_key?: string; model?: string; base_url?: string };
    gemini?: { api_key?: string; model?: string };
  };
}

const isMarker = (v: string) => v.startsWith("***");

export function MemoryPanel() {
  const toast = useToast();
  const { config, isLoading, patch } = useGlobalConfig();
  const { data: providers, mutate: mutateProviders } = useSWR(
    "/embeddings/providers",
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

  const apply = async (set: Record<string, unknown>) => {
    setBusy(true);
    try {
      await patch(set);
      await mutateProviders();
    } catch (e) {
      toast.error(`No se pudo guardar: ${(e as Error).message}`);
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
      toast.success(`Embedding OK con ${r.embedder}`);
    } catch (e) {
      toast.error(`Falló el test: ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  };

  const runReindex = async () => {
    setBusy(true);
    try {
      const r = await Embeddings.reindex();
      toast.success(`Reindexado: ${r.indexed} chunks (limpiados ${r.cleared}).`);
    } catch (e) {
      toast.error(`Falló el reindex: ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-6">
      <Section
        title="Embeddings (RAG)"
        description="Modelo que vectoriza el historial de todos los canales para la memoria relevante. Igual que TTS/STT: elegí proveedor y modelo. 'Automático' prueba local primero y cae al offline si no hay nada."
      >
        <div className="space-y-3">
          <Field label="Proveedor" hint="Ollama es local y gratis. Gemini/OpenAI usan la API key de su sección en Modelos (o la de acá abajo).">
            <UiSelect
              value={provider}
              onChange={(v) => apply({ "memory.embeddings.provider": v })}
              options={PROVIDER_OPTIONS}
              disabled={busy}
              className="max-w-xl"
            />
          </Field>

          <Field label="Modo de selección" hint="Cadena cae al siguiente si uno falla; Único usa exactamente el proveedor elegido.">
            <UiSelect
              value={mode}
              onChange={(v) => apply({ "memory.embeddings.mode": v })}
              options={MODE_OPTIONS}
              disabled={busy}
              className="max-w-md"
            />
          </Field>

          <div className="flex flex-wrap items-center gap-2 pt-1">
            {engines.map((e) => (
              <Badge key={e.id} tone={e.available ? "success" : "muted"}>
                {e.id}: {e.available ? "disponible" : "no disp."}
              </Badge>
            ))}
          </div>

          <div className="flex flex-wrap items-center gap-3 pt-1">
            <Button variant="secondary" onClick={runTest} loading={busy}>
              <Sparkles size={14} /> Probar embedding
            </Button>
            <Button variant="secondary" onClick={runReindex} loading={busy}>
              <Database size={14} /> Reindexar memoria
            </Button>
            {testResult && <span className="text-sm text-muted-foreground">{testResult}</span>}
          </div>
        </div>
      </Section>

      <Section title="Ollama (local)" description="Sin API key. Corre nomic-embed-text en tu Ollama local o cloud.">
        <Field label="Modelo">
          <Input
            defaultValue={emb.ollama?.model || "nomic-embed-text"}
            placeholder="nomic-embed-text"
            disabled={busy}
            onBlur={(ev) => {
              const v = ev.target.value.trim();
              if (v && v !== emb.ollama?.model) apply({ "memory.embeddings.ollama.model": v });
            }}
            className="max-w-md"
          />
        </Field>
        <Field label="Base URL" hint='Vacío usa engines.ollama.base_url (por defecto http://localhost:11434).'>
          <Input
            defaultValue={emb.ollama?.base_url || ""}
            placeholder="http://localhost:11434"
            disabled={busy}
            onBlur={(ev) => apply({ "memory.embeddings.ollama.base_url": ev.target.value.trim() })}
            className="max-w-md"
          />
        </Field>
      </Section>

      <Section title="OpenAI" description="text-embedding-3-small (1536 dims) u otro modelo compatible.">
        <Field label="Modelo">
          <Input
            defaultValue={emb.openai?.model || "text-embedding-3-small"}
            placeholder="text-embedding-3-small"
            disabled={busy}
            onBlur={(ev) => {
              const v = ev.target.value.trim();
              if (v && v !== emb.openai?.model) apply({ "memory.embeddings.openai.model": v });
            }}
            className="max-w-md"
          />
        </Field>
        <Field label="API key" hint="Vacío reusa engines.openai.api_key. Dejalo en blanco para no tocar la guardada.">
          <Input
            type="password"
            defaultValue={emb.openai?.api_key || ""}
            placeholder="sk-…"
            disabled={busy}
            onBlur={(ev) => {
              const v = ev.target.value;
              if (v && !isMarker(v)) apply({ "memory.embeddings.openai.api_key": v });
            }}
            className="max-w-md"
          />
        </Field>
      </Section>

      <Section title="Gemini" description="text-embedding-004 (768 dims). Free tier con API key de Google.">
        <Field label="Modelo">
          <Input
            defaultValue={emb.gemini?.model || "text-embedding-004"}
            placeholder="text-embedding-004"
            disabled={busy}
            onBlur={(ev) => {
              const v = ev.target.value.trim();
              if (v && v !== emb.gemini?.model) apply({ "memory.embeddings.gemini.model": v });
            }}
            className="max-w-md"
          />
        </Field>
        <Field label="API key" hint="Vacío reusa engines.gemini.api_key.">
          <Input
            type="password"
            defaultValue={emb.gemini?.api_key || ""}
            placeholder="AIza…"
            disabled={busy}
            onBlur={(ev) => {
              const v = ev.target.value;
              if (v && !isMarker(v)) apply({ "memory.embeddings.gemini.api_key": v });
            }}
            className="max-w-md"
          />
        </Field>
      </Section>
    </div>
  );
}
