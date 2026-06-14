import { useState, type ReactNode } from "react";
import useSWR from "swr";
import { Bot, Crown, Plus, Sparkles, Trash2, Wrench, Pencil, RotateCcw } from "lucide-react";
import { Agents } from "../../lib/api";
import { Section } from "../../components/Section";
import { Badge, Button, Dialog, Empty, Field, Input, Loading, Switch, Textarea } from "../../components/ui";
import { Tooltip, TooltipContent, TooltipTrigger } from "../../components/ui/tooltip";
import { useToast } from "../../components/Toast";
import { t } from "../../i18n";
import type { AgentEntry } from "../../types/daemon";

type VaultAgent = AgentEntry & { source?: "bundled" | "user" | "user-override" };

// Two-layer vault editor:
//   - bundled defaults (read-only on disk, ALWAYS visible unless the user
//     explicitly tombstoned them)
//   - user layer (~/.apx/agents) — new agents the user created, or
//     copy-on-write overrides of bundled defaults
// The "Mostrar removidos" toggle exposes tombstoned slugs so they can be
// restored without a CLI roundtrip.
export function AgentDefaultsTab() {
  const toast = useToast();
  const [showRemoved, setShowRemoved] = useState(false);
  const swrKey = showRemoved ? "/agents/vault?include_removed=1" : "/agents/vault";
  const vault = useSWR(swrKey, () => Agents.vault({ includeRemoved: showRemoved }));
  const items = (vault.data || []) as VaultAgent[];

  const [editing, setEditing] = useState<VaultAgent | "new" | null>(null);

  const remove = async (a: VaultAgent) => {
    const tombstoning = a.source !== "user";
    const msg = tombstoning
      ? t("base.defaults_tombstone_msg", { slug: a.slug })
      : t("base.defaults_delete_msg", { slug: a.slug });
    if (!confirm(msg)) return;
    try {
      await Agents.vaultRemove(a.slug);
      toast.success(tombstoning ? t("base.defaults_hidden") : t("base.defaults_deleted"));
      vault.mutate();
    } catch (e) { toast.error((e as Error).message); }
  };

  const restore = async (slug: string) => {
    try { await Agents.vaultRestore(slug); toast.success(t("base.defaults_restored")); vault.mutate(); }
    catch (e) { toast.error((e as Error).message); }
  };

  return (
    <Section
      title={t("base.defaults_title")}
      description={t("base.defaults_desc")}
      action={
        <div className="flex items-center gap-2">
          <Switch checked={showRemoved} onChange={setShowRemoved} label={t("base.defaults_show_removed")} />
          <Button size="sm" onClick={() => setEditing("new")}>
            <Plus size={14} /> {t("base.defaults_new")}
          </Button>
        </div>
      }
    >
      {vault.isLoading && <Loading />}
      {!vault.isLoading && items.length === 0 && (
        <Empty>{t("base.defaults_empty")}</Empty>
      )}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {items.map((a) => {
          const tombstoned = showRemoved && (a as { tombstoned?: boolean }).tombstoned;
          return (
            <div
              key={a.slug}
              className={`flex flex-col gap-2 rounded-xl border bg-card p-4 ${tombstoned ? "border-dashed border-border opacity-60" : "border-border"}`}
            >
              <div className="flex items-center justify-between gap-2">
                <div className="flex min-w-0 items-center gap-2">
                  <div className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-slate-600 to-gray-600">
                    {a.is_master ? <Crown className="size-4 text-white" /> : <Bot className="size-4 text-white" />}
                  </div>
                  <span className="truncate text-sm font-semibold">{a.slug}</span>
                  <SourceBadge source={a.source} />
                </div>
                <div className="flex shrink-0 items-center gap-0.5">
                  {tombstoned ? (
                    <IconBtn label={t("base.defaults_restore")} onClick={() => restore(a.slug)} variant="secondary"><RotateCcw size={13} /></IconBtn>
                  ) : (
                    <>
                      <IconBtn label={t("base.defaults_edit")} onClick={() => setEditing(a)} variant="ghost"><Pencil size={13} /></IconBtn>
                      <IconBtn
                        label={a.source === "user" ? t("base.defaults_delete") : t("base.defaults_hide")}
                        onClick={() => remove(a)}
                        variant="ghost-destructive"
                      >
                        <Trash2 size={13} />
                      </IconBtn>
                    </>
                  )}
                </div>
              </div>
              {a.model
                ? <Badge tone="info">{a.model}</Badge>
                : <span className="text-[10px] text-muted-fg">{t("agents_ui.model_router_default")}</span>}
              {a.description && <p className="line-clamp-3 text-xs text-muted-fg">{a.description}</p>}
              <div className="flex flex-wrap gap-1">
                {a.role && <Badge>{a.role}</Badge>}
                {a.skills?.map((s) => <span key={s} className="inline-flex items-center gap-0.5 rounded bg-muted px-1 py-0.5 text-[9px] text-muted-fg"><Sparkles size={9} /> {s}</span>)}
                {a.tools?.map((t) => <span key={t} className="inline-flex items-center gap-0.5 rounded bg-muted px-1 py-0.5 text-[9px] text-muted-fg"><Wrench size={9} /> {t}</span>)}
              </div>
            </div>
          );
        })}
      </div>

      {editing !== null && (
        <VaultAgentDialog
          agent={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); vault.mutate(); }}
        />
      )}
    </Section>
  );
}

function SourceBadge({ source }: { source?: VaultAgent["source"] }) {
  if (source === "user")          return <Badge tone="success">{t("agents_ui.source_user")}</Badge>;
  if (source === "user-override") return <Badge tone="warning">{t("agents_ui.source_override")}</Badge>;
  return <Badge tone="muted">{t("agents_ui.source_bundled")}</Badge>;
}

// Small square icon button with a tooltip; keeps the card header compact.
// We use the ui Button for the destructive variant fallback via className.
function IconBtn({
  label,
  onClick,
  variant = "ghost",
  children,
}: {
  label: string;
  onClick: () => void;
  variant?: "ghost" | "ghost-destructive" | "secondary";
  children: ReactNode;
}) {
  const base = "inline-flex size-7 items-center justify-center rounded-md transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40";
  const variants = {
    ghost: "text-muted-fg hover:bg-accent hover:text-accent-fg",
    "ghost-destructive": "text-muted-fg hover:bg-destructive/15 hover:text-destructive",
    secondary: "bg-secondary text-secondary-foreground hover:bg-secondary/80",
  } as const;
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <button type="button" onClick={onClick} aria-label={label} className={`${base} ${variants[variant]}`}>
            {children}
          </button>
        }
      />
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

// Create / edit dialog. When opened on a bundled agent the API patch will
// copy-on-write it to the user layer; we don't need to do anything special
// here — just submit the merged fields.
function VaultAgentDialog({
  agent, onClose, onSaved,
}: { agent: VaultAgent | null; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const isNew = !agent;
  const [slug, setSlug] = useState(agent?.slug ?? "");
  const [role, setRole] = useState(agent?.role ?? "");
  const [model, setModel] = useState(agent?.model ?? "");
  const [description, setDescription] = useState(agent?.description ?? "");
  const [language, setLanguage] = useState<string>(
    (agent as unknown as { language?: string })?.language ?? "es",
  );
  const [skills, setSkills] = useState((agent?.skills ?? []).join(", "));
  const [tools, setTools] = useState((agent?.tools ?? []).join(", "));
  const [isMaster, setIsMaster] = useState(!!agent?.is_master);
  const [body, setBody] = useState((agent as unknown as { body?: string })?.body ?? "");

  const submit = async () => {
    const fields = {
      role: role || undefined,
      model: model || undefined,
      description: description || undefined,
      language: language || undefined,
      skills,    // CSV; the API normalizes to an array
      tools,
      is_master: isMaster,
    };
    setBusy(true);
    try {
      if (isNew) {
        if (!/^[a-z][a-z0-9_-]*$/.test(slug)) {
          throw new Error(t("base.defaults_slug_invalid"));
        }
        await Agents.vaultCreate(slug, fields, body);
        toast.success(t("base.defaults_created", { slug }));
      } else {
        await Agents.vaultPatch(agent!.slug, { fields, body });
        toast.success(t("base.defaults_saved", { slug: agent!.slug }));
      }
      onSaved();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open
      onClose={onClose}
      title={isNew ? t("base.defaults_new_title") : t("base.defaults_edit_title", { slug: agent!.slug })}
      description={isNew
        ? t("base.defaults_new_desc")
        : agent!.source === "bundled"
          ? t("base.defaults_bundled_desc")
          : t("base.defaults_user_desc")
      }
      size="lg"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>{t("common.cancel")}</Button>
          <Button variant="primary" onClick={submit} loading={busy}>{t("common.save")}</Button>
        </>
      }
    >
      <div className="space-y-3">
        {isNew && (
          <Field label="slug" hint={t("agents_ui.slug_kebab_hint")}>
            <Input autoFocus value={slug} onChange={(e) => setSlug(e.target.value)} placeholder="reviewer" />
          </Field>
        )}
        <div className="grid grid-cols-2 gap-3">
          <Field label="role">
            <Input value={role} onChange={(e) => setRole(e.target.value)} placeholder="Code reviewer" />
          </Field>
          <Field label="model">
            <Input value={model} onChange={(e) => setModel(e.target.value)} placeholder="openrouter:..." />
          </Field>
          <Field label="language">
            <Input value={language} onChange={(e) => setLanguage(e.target.value)} placeholder="es" />
          </Field>
          <Field label="is_master">
            <div className="flex h-9 items-center">
              <Switch checked={isMaster} onChange={setIsMaster} label={t("base.defaults_master_label")} />
            </div>
          </Field>
        </div>
        <Field label="description">
          <Input value={description} onChange={(e) => setDescription(e.target.value)} />
        </Field>
        <Field label="skills" hint={t("agents_ui.comma_separated")}>
          <Input value={skills} onChange={(e) => setSkills(e.target.value)} placeholder="code-review, git" />
        </Field>
        <Field label="tools" hint={t("agents_ui.comma_separated")}>
          <Input value={tools} onChange={(e) => setTools(e.target.value)} placeholder="read, write, run" />
        </Field>
        <Field label="body" hint={t("agents_ui.body_hint")}>
          <Textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            rows={10}
            placeholder="# Mission\n..."
          />
        </Field>
      </div>
    </Dialog>
  );
}
