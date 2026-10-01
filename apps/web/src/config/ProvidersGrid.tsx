import type { ProviderInfo } from "@apx/protocol";
import { Badge, Button, Dialog, IconButton, Icons, Input, ProjectTile, Switch } from "@apx/ui";
import { useEffect, useState } from "react";
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

/** Model APIs our own loop calls, as cards, plus a card to add one. */
export function ProvidersGrid() {
  const t = useT();
  const list = useProviders((s) => s.list);
  const [editing, setEditing] = useState<ProviderInfo | "new" | undefined>();
  useEffect(() => {
    void loadProviders();
  }, []);
  return (
    <>
      <div className="pgrid">
        {list.map((p) => (
          <ProviderCard key={p.id} p={p} onEdit={() => setEditing(p)} />
        ))}
        <button type="button" className="pcard pcard--add" onClick={() => setEditing("new")}>
          <Icons.Plus size={18} />
          <span>{t("providers.add")}</span>
        </button>
      </div>
      {editing && (
        <ProviderDialog
          initial={editing === "new" ? undefined : editing}
          taken={list.map((p) => p.id)}
          onClose={() => setEditing(undefined)}
        />
      )}
    </>
  );
}

function ProviderCard({ p, onEdit }: { p: ProviderInfo; onEdit: () => void }) {
  const t = useT();
  const preset = presetOf(p.preset ?? p.id);
  const ready = p.enabled && p.key_set;
  return (
    <div className={p.enabled ? "pcard" : "pcard is-off"}>
      <div className="pcard__top">
        <ProjectTile tone={preset?.tone ?? "neutral"} initial={p.label.slice(0, 1).toUpperCase()} size={36} />
        <div className="pcard__titles">
          <div className="pcard__name">{p.label}</div>
          <div className="pcard__id">{p.id}</div>
        </div>
        <Badge tone={ready ? "brand" : p.enabled ? "warning" : "neutral"} dot>
          {ready ? t("providers.active") : p.enabled ? t("providers.noKey") : t("providers.off")}
        </Badge>
      </div>
      <dl className="pcard__rows">
        <dt>{t("providers.url")}</dt>
        <dd title={p.base_url}>{p.base_url.replace(/^https?:\/\//, "")}</dd>
        <dt>{t("providers.key")}</dt>
        <dd>{!p.needs_key ? t("providers.keyNone") : p.key_set ? t("providers.keySet") : "—"}</dd>
        <dt>{t("providers.models")}</dt>
        <dd>{p.models.length ? p.models.join(", ") : t("providers.modelsAsked")}</dd>
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
          onClick={() => void removeProvider(p.id)}
        />
      </div>
    </div>
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
  taken,
  onClose,
}: {
  initial: ProviderInfo | undefined;
  taken: string[];
  onClose: () => void;
}) {
  const t = useT();
  const start = presetOf(initial?.preset ?? initial?.id ?? "opencode-zen");
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
              <ProjectTile tone={p.tone} initial={p.label.slice(0, 1)} size={18} />
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
              placeholder={initial?.key_set ? t("providers.keyKeep") : "sk-…"}
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
