import { useState } from "react";
import { Plus } from "lucide-react";
import { Section } from "../Section";
import { Button, Empty, Loading } from "../ui";
import { useToast } from "../Toast";
import { useGlobalConfig } from "../../hooks/useGlobalConfig";
import { ENGINE_OPTIONS } from "./providers/typeStyles";
import { ProviderCard } from "./providers/ProviderCard";
import { ProviderModal, type ProviderSaveResult } from "./providers/ProviderModal";
import type { Provider } from "./providers/types";
import { t } from "../../i18n";

const KNOWN_ENGINES = new Set(ENGINE_OPTIONS.map((o) => o.value));

function toProvider(slug: string, v: Record<string, unknown>): Provider {
  const engine = (typeof v.engine === "string" && v.engine) || (KNOWN_ENGINES.has(slug as any) ? slug : "custom");
  return {
    slug,
    name: typeof v.name === "string" ? v.name : undefined,
    engine,
    base_url: typeof v.base_url === "string" ? v.base_url : undefined,
    api_key: typeof v.api_key === "string" ? v.api_key : undefined,
    default_model: typeof v.default_model === "string" ? v.default_model : undefined,
    default_temperature: typeof v.default_temperature === "number" ? v.default_temperature : undefined,
    default_max_tokens: typeof v.default_max_tokens === "number" ? v.default_max_tokens : undefined,
    is_active: typeof v.is_active === "boolean" ? v.is_active : undefined,
    context_limit_tokens: typeof v.context_limit_tokens === "number" ? v.context_limit_tokens : undefined,
    model_context_limits: (v.model_context_limits as Record<string, number>) || undefined,
    pricing: (v.pricing as Provider["pricing"]) || undefined,
  };
}

export function EnginesPanel() {
  const toast = useToast();
  const { config, isLoading, patch, mutate } = useGlobalConfig();
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<Provider | null>(null);

  if (isLoading) return <Loading />;

  const engines = (config.engines || {}) as unknown as Record<string, Record<string, unknown>>;
  const providers = Object.entries(engines).map(([slug, v]) => toProvider(slug, v || {}));
  const slugs = providers.map((p) => p.slug);

  const openCreate = () => { setEditing(null); setModalOpen(true); };
  const openEdit = (p: Provider) => { setEditing(p); setModalOpen(true); };

  const save = async ({ provider, apiKeyValue, raw }: ProviderSaveResult) => {
    // JSON mode: replace the whole engines.<slug> block with the parsed object.
    if (raw) {
      await patch({ [`engines.${provider.slug}`]: raw });
      toast.success("Provider guardado (JSON).");
      mutate();
      return;
    }
    const base = `engines.${provider.slug}`;
    const set: Record<string, unknown> = {
      [`${base}.name`]: provider.name,
      [`${base}.engine`]: provider.engine,
      [`${base}.is_active`]: provider.is_active !== false,
      [`${base}.default_temperature`]: provider.default_temperature,
      [`${base}.default_max_tokens`]: provider.default_max_tokens,
    };
    const unset: string[] = [];
    const opt = (key: string, val: unknown) => { if (val === undefined || val === "" ) unset.push(`${base}.${key}`); else set[`${base}.${key}`] = val; };
    opt("base_url", provider.base_url);
    opt("default_model", provider.default_model);
    opt("context_limit_tokens", provider.context_limit_tokens);
    opt("pricing", provider.pricing);
    opt("model_context_limits", provider.model_context_limits);
    if (apiKeyValue) set[`${base}.api_key`] = apiKeyValue;

    await patch(set, unset);
    toast.success("Provider guardado.");
    mutate();
  };

  const toggle = async (p: Provider) => {
    try {
      await patch({ [`engines.${p.slug}.is_active`]: !(p.is_active !== false) });
      mutate();
    } catch (e) { toast.error((e as Error).message); }
  };

  const remove = async (p: Provider) => {
    if (!confirm(`Borrar provider ${p.name || p.slug}?`)) return;
    try {
      await patch(undefined, [`engines.${p.slug}`]);
      toast.success("Provider borrado.");
      mutate();
    } catch (e) { toast.error((e as Error).message); }
  };

  return (
    <Section
      title={t("engines_panel.title")}
      description="Proveedores LLM (API). Cada provider usa un engine/adapter (openai, ollama, …) con su key y URL."
      action={<Button size="sm" variant="primary" onClick={openCreate}><Plus size={14} /> {t("engines_panel.new_btn")}</Button>}
    >
      {providers.length === 0 ? (
        <Empty>Sin providers. Agregá uno con el botón de arriba.</Empty>
      ) : (
        <div className="grid grid-cols-1 items-stretch gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {providers.map((p) => (
            <ProviderCard key={p.slug} provider={p} onEdit={() => openEdit(p)} onDelete={() => remove(p)} onToggle={() => toggle(p)} />
          ))}
          <button
            type="button"
            onClick={openCreate}
            className="flex min-h-[120px] flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-border text-muted-fg transition-colors hover:border-muted-fg/60 hover:text-foreground"
          >
            <Plus size={20} />
            <span className="text-sm font-medium">Agregar provider</span>
          </button>
        </div>
      )}

      <ProviderModal
        open={modalOpen}
        initial={editing}
        existingSlugs={slugs}
        onClose={() => { setModalOpen(false); setEditing(null); }}
        onSave={save}
      />
    </Section>
  );
}
