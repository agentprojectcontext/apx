import type { ProviderInfo } from "@apx/protocol";
import { Badge, Button, Dialog, EngineIcon, engineBrand, IconButton, Icons, Input, ProjectTile, Switch } from "@apx/ui";
import { useEffect, useState } from "react";
import { createStore, useSlice } from "../data/createStore.ts";
import { useModels } from "../data/models.ts";
import {
  loadProviders,
  type ProviderDraft,
  removeProvider,
  saveProvider,
  setProviderEnabled,
  useProviders,
} from "../data/providers.ts";
import { useT } from "../i18n/index.ts";
import { PROVIDER_PRESETS, presetOf } from "./models/providerPresets.ts";
import { PlanCard } from "./PlanCard.tsx";

/** Which provider dialog is open: an existing provider, a new one of a kind (preset), or none. */
const editor = createStore<{ open: { id?: string; preset?: string } | undefined }>({ open: undefined });

/** Known kinds the owner took off the list of suggestions (kept per device). */
const HIDDEN_KEY = "apx.providers.hidden";
const hidden = createStore<{ ids: string[] }>({ ids: readHidden() });
function readHidden(): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(HIDDEN_KEY) ?? "[]") as unknown;
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}
function hideSuggestion(id: string): void {
  const ids = [...new Set([...hidden.get().ids, id])];
  hidden.set({ ids });
  try {
    localStorage.setItem(HIDDEN_KEY, JSON.stringify(ids));
  } catch {
    // Private mode: hidden for this visit only.
  }
}

/** The look of a provider: its brand's mark, or a tile with its initial. */
function ProviderMark({ id, label, size }: { id: string; label: string; size: number }) {
  return engineBrand(id) ? (
    <EngineIcon engine={id} tile size={size} />
  ) : (
    <ProjectTile tone={presetOf(id)?.tone ?? "neutral"} initial={label.slice(0, 1).toUpperCase()} size={size} />
  );
}

/** The kind a provider is for its look: its preset, or its own id for a built-in. */
const kindOf = (p: ProviderInfo) => p.preset ?? p.id;
/** Ready first, then on but missing its key, then off. */
const rank = (p: ProviderInfo) => (p.enabled && p.key_set ? 0 : p.enabled ? 1 : 2);

/**
 * Model APIs our own loop calls, as cards: the ChatGPT plan first (fixed), the ones set up (ready first), then the
 * known kinds not set up yet (each can be taken off the list), then a card to add any OpenAI-compatible one.
 */
export function ProvidersGrid({ compact = false }: { compact?: boolean }) {
  const t = useT();
  const list = useProviders((s) => s.list);
  const open = useSlice(editor, (s) => s.open);
  const hiddenIds = useSlice(hidden, (s) => s.ids);
  const plan = list.find((p) => p.sign_in === "chatgpt");
  useEffect(() => {
    void loadProviders();
  }, []);
  const apis = list.filter((p) => !p.sign_in).sort((a, b) => rank(a) - rank(b));
  const taken = new Set(apis.flatMap((p) => [p.id, kindOf(p)]));
  const unset = PROVIDER_PRESETS.filter(
    (k) =>
      k.id !== "custom" &&
      !taken.has(k.id) &&
      !hiddenIds.includes(k.id) &&
      (!compact || ["gemini", "anthropic", "openai"].includes(k.id)),
  );
  const close = () => editor.set({ open: undefined });
  const editing = open?.id ? list.find((p) => p.id === open.id) : undefined;
  return (
    <>
      <div className={compact ? "pgrid pgrid--compact" : "pgrid"}>
        {plan && <PlanCard p={plan} compact={compact} />}
        {apis.map((p) => (
          <ProviderCard key={p.id} p={p} compact={compact} onEdit={() => editor.set({ open: { id: p.id } })} />
        ))}
        {unset.map((k) => (
          <div key={k.id} className="pcard is-unset">
            <div className="pcard__top">
              <ProviderMark id={k.id} label={k.label} size={36} />
              <div className="pcard__titles">
                <div className="pcard__name">{k.label}</div>
                <div className="pcard__id">{k.id}</div>
              </div>
              <Badge tone="neutral">{t("providers.unset")}</Badge>
            </div>
            <p className="pcard__hint">{t(k.needs_key ? "providers.unsetKey" : "providers.unsetLocal")}</p>
            <div className="pcard__actions">
              <Button size="sm" variant="secondary" onClick={() => editor.set({ open: { preset: k.id } })}>
                {t("providers.setUp")}
              </Button>
              <span className="pcard__spacer" />
              <IconButton
                size="sm"
                label={t("providers.hide", { name: k.label })}
                icon={<Icons.Trash2 size={14} />}
                onClick={() => hideSuggestion(k.id)}
              />
            </div>
          </div>
        ))}
        <button type="button" className="pcard pcard--add" onClick={() => editor.set({ open: { preset: "custom" } })}>
          <Icons.Plus size={18} />
          <span>{t("providers.add")}</span>
        </button>
      </div>
      {open && (
        <ProviderDialog
          key={`${open.id ?? ""}:${open.preset ?? ""}`}
          initial={editing}
          preset={open.preset}
          taken={list.map((p) => p.id)}
          onClose={close}
        />
      )}
    </>
  );
}

function ProviderCard({ p, onEdit, compact }: { p: ProviderInfo; onEdit: () => void; compact: boolean }) {
  const t = useT();
  const ready = p.enabled && p.key_set;
  return (
    <div className={p.enabled ? "pcard" : "pcard is-off"}>
      <div className="pcard__top">
        <ProviderMark id={kindOf(p)} label={p.label} size={compact ? 28 : 36} />
        <div className="pcard__titles">
          <div className="pcard__name">{p.label}</div>
          <div className="pcard__id">{p.id}</div>
        </div>
        <Badge tone={ready ? "brand" : p.enabled ? "warning" : "neutral"} dot>
          {ready ? t("providers.active") : !p.enabled ? t("providers.off") : t("providers.noKey")}
        </Badge>
      </div>
      <dl className="pcard__rows">
        <dt>{t("providers.url")}</dt>
        <dd title={p.base_url}>{p.base_url.replace(/^https?:\/\//, "")}</dd>
        <dt>{t("providers.key")}</dt>
        <dd>{!p.needs_key ? t("providers.keyNone") : p.key_set ? `****${p.key_hint ?? ""}` : "—"}</dd>
        {!compact && (
          <>
            <dt>{t("providers.models")}</dt>
            <dd>
              <ModelCount p={p} />
            </dd>
          </>
        )}
      </dl>
      <div className="pcard__actions">
        <Switch
          size="sm"
          checked={p.enabled}
          onCheckedChange={(on) => void setProviderEnabled(p, on)}
          label={t("providers.on")}
        />
        <span className="pcard__spacer" />
        <IconButton size="sm" label={t("providers.edit")} icon={<Icons.Pencil size={14} />} onClick={onEdit} />
        <IconButton
          size="sm"
          label={t("providers.remove")}
          icon={<Icons.Trash2 size={14} />}
          // Removed means gone from the grid: not back as a suggestion of the same kind ("Add provider" still has it).
          onClick={() => void removeProvider(p.id).then(() => hideSuggestion(kindOf(p)))}
        />
      </div>
    </div>
  );
}

/** How many chat models the provider offers now, as it listed them; "Auto" until it has (no key yet, not asked). */
function ModelCount({ p }: { p: ProviderInfo }) {
  const t = useT();
  const e = useModels((s) => s.catalog.find((x) => x.id === p.id));
  const count = e?.available ? e.models.filter((m) => m.chat).length : 0;
  return count ? (
    <>{t("plans.modelsCount", { count })}</>
  ) : (
    <Badge tone="neutral" title={t("providers.modelsAsked")}>
      {t("providers.modelsAuto")}
    </Badge>
  );
}

const slug = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 32);

/** Add or edit one provider: pick its kind, check the address, paste the key (stored in the Keychain). */
function ProviderDialog({
  initial,
  preset,
  taken,
  onClose,
}: {
  initial: ProviderInfo | undefined;
  /** For a new one: the kind it starts as. */
  preset?: string | undefined;
  taken: string[];
  onClose: () => void;
}) {
  const t = useT();
  const start = presetOf(initial?.preset ?? initial?.id ?? preset ?? "opencode-zen");
  const [draft, setDraft] = useState<ProviderDraft>(() => ({
    id: initial?.id ?? "",
    label: initial?.label ?? start?.label ?? "",
    preset: initial?.preset ?? start?.id ?? "custom",
    transport: initial?.transport ?? start?.transport ?? "openai-chat",
    base_url: initial?.base_url ?? start?.base_url ?? "",
    needs_key: initial?.needs_key ?? start?.needs_key ?? true,
    models: initial?.models ?? [],
    enabled: initial?.enabled ?? true,
  }));
  const [key, setKey] = useState("");
  const [models, setModels] = useState((initial?.models ?? []).join(", "));
  const [saving, setSaving] = useState(false);
  const id = initial?.id ?? (slug(draft.id || draft.label) || "provider");
  const clash = !initial && taken.includes(id);
  const valid = /^https?:\/\/.+/.test(draft.base_url) && !clash;

  const pickPreset = (pid: string) => {
    const p = presetOf(pid);
    if (!p) return;
    setDraft((d) => ({
      ...d,
      preset: p.id,
      transport: p.transport,
      base_url: p.base_url,
      needs_key: p.needs_key,
      label: initial ? d.label : p.label,
    }));
  };
  const save = async () => {
    setSaving(true);
    const list = models
      .split(",")
      .map((m) => m.trim())
      .filter(Boolean);
    if (await saveProvider({ ...draft, id, models: list }, key || undefined)) onClose();
    setSaving(false);
  };

  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      size="lg"
      title={initial ? t("providers.editTitle", { name: initial.label }) : t("providers.newTitle")}
      description={t("providers.dialogLead")}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button disabled={!valid} loading={saving} onClick={() => void save()}>
            {initial ? t("common.save") : t("providers.create")}
          </Button>
        </>
      }
    >
      <div className="pform">
        <div className="pform__label">{t("providers.kind")}</div>
        <div className="pform__presets">
          {PROVIDER_PRESETS.map((p) => (
            <button
              key={p.id}
              type="button"
              className={draft.preset === p.id ? "pform__preset is-on" : "pform__preset"}
              onClick={() => pickPreset(p.id)}
            >
              <ProviderMark id={p.id} label={p.label} size={18} />
              {p.label}
            </button>
          ))}
        </div>
        <div className="pform__field">
          <span className="pform__label">{t("providers.name")}</span>
          <Input
            aria-label={t("providers.name")}
            value={draft.label}
            onChange={(e) => setDraft({ ...draft, label: e.currentTarget.value })}
          />
          {!initial && (
            <span className={clash ? "pform__hint is-error" : "pform__hint"}>
              {clash ? t("providers.idTaken", { id }) : t("providers.idHint", { id })}
            </span>
          )}
        </div>
        <div className="pform__field">
          <span className="pform__label">{t("providers.url")}</span>
          <Input
            aria-label={t("providers.url")}
            value={draft.base_url}
            placeholder="https://…/v1"
            onChange={(e) => setDraft({ ...draft, base_url: e.currentTarget.value })}
          />
        </div>
        {draft.needs_key && (
          <div className="pform__field">
            <span className="pform__label">{t("providers.key")}</span>
            <Input
              aria-label={t("providers.key")}
              type="password"
              autoComplete="off"
              value={key}
              placeholder={initial?.key_set ? `****${initial.key_hint ?? ""} — ${t("providers.keyKeep")}` : "sk-…"}
              onChange={(e) => setKey(e.currentTarget.value)}
            />
            <span className="pform__hint">{t("providers.keyHint")}</span>
          </div>
        )}
        <div className="pform__field">
          <span className="pform__label">{t("providers.fixedModels")}</span>
          <Input
            aria-label={t("providers.fixedModels")}
            value={models}
            placeholder="qwen3:8b, gemma3:4b"
            onChange={(e) => setModels(e.currentTarget.value)}
          />
          <span className="pform__hint">{t("providers.fixedModelsHint")}</span>
        </div>
        <Switch
          checked={draft.enabled}
          onCheckedChange={(enabled) => setDraft({ ...draft, enabled })}
          label={t("providers.enabled")}
          description={t("providers.enabledHint")}
        />
      </div>
    </Dialog>
  );
}
