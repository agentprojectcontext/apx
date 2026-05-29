import { useState, type ReactNode } from "react";
import useSWR from "swr";
import { Bot, Crown, Plus, Sparkles, Trash2, Wrench, Pencil, RotateCcw } from "lucide-react";
import { Agents } from "../../lib/api";
import { Section } from "../../components/Section";
import { Badge, Button, Dialog, Empty, Field, Input, Loading, Switch, Textarea } from "../../components/ui";
import { Tooltip, TooltipContent, TooltipTrigger } from "../../components/ui/tooltip";
import { useToast } from "../../components/Toast";
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
      ? `Ocultar el default "${a.slug}"? Es bundled — quedá tombstoneado y lo recuperás con Restaurar.`
      : `Borrar el template "${a.slug}"?`;
    if (!confirm(msg)) return;
    try {
      await Agents.vaultRemove(a.slug);
      toast.success(tombstoning ? "Ocultado." : "Borrado.");
      vault.mutate();
    } catch (e) { toast.error((e as Error).message); }
  };

  const restore = async (slug: string) => {
    try { await Agents.vaultRestore(slug); toast.success("Restaurado."); vault.mutate(); }
    catch (e) { toast.error((e as Error).message); }
  };

  return (
    <Section
      title="Agent defaults"
      description="Plantillas globales del vault. Las bundled vienen con APX y siempre están; las que crees o edites quedan en ~/.apx/agents y se superponen. Importalas a un proyecto desde Agents › Importar."
      action={
        <div className="flex items-center gap-2">
          <Switch checked={showRemoved} onChange={setShowRemoved} label="Mostrar removidos" />
          <Button size="sm" onClick={() => setEditing("new")}>
            <Plus size={14} /> Nuevo
          </Button>
        </div>
      }
    >
      {vault.isLoading && <Loading />}
      {!vault.isLoading && items.length === 0 && (
        <Empty>Sin plantillas en el vault.</Empty>
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
                    <IconBtn label="Restaurar" onClick={() => restore(a.slug)} variant="secondary"><RotateCcw size={13} /></IconBtn>
                  ) : (
                    <>
                      <IconBtn label="Editar" onClick={() => setEditing(a)} variant="ghost"><Pencil size={13} /></IconBtn>
                      <IconBtn
                        label={a.source === "user" ? "Borrar" : "Ocultar"}
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
                : <span className="text-[10px] text-muted-fg">modelo: default del router</span>}
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
  if (source === "user")          return <Badge tone="success">user</Badge>;
  if (source === "user-override") return <Badge tone="warning">override</Badge>;
  return <Badge tone="muted">bundled</Badge>;
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
          throw new Error("slug inválido (debe matchear /^[a-z][a-z0-9_-]*$/)");
        }
        await Agents.vaultCreate(slug, fields, body);
        toast.success(`Template "${slug}" creado.`);
      } else {
        await Agents.vaultPatch(agent!.slug, { fields, body });
        toast.success(`Template "${agent!.slug}" guardado.`);
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
      title={isNew ? "Nuevo template" : `Editar "${agent!.slug}"`}
      description={isNew
        ? "POST /agents/vault — se guarda en ~/.apx/agents/<slug>.md"
        : agent!.source === "bundled"
          ? "Es un default bundled. Al guardar se hace copy-on-write a ~/.apx/agents/<slug>.md (queda como override)."
          : "PATCH /agents/vault/:slug — edita el archivo en ~/.apx/agents."
      }
      size="lg"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>Cancelar</Button>
          <Button variant="primary" onClick={submit} loading={busy}>Guardar</Button>
        </>
      }
    >
      <div className="space-y-3">
        {isNew && (
          <Field label="slug" hint="kebab-case, ej. reviewer, my-agent, content-writer">
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
              <Switch checked={isMaster} onChange={setIsMaster} label="Agente master" />
            </div>
          </Field>
        </div>
        <Field label="description">
          <Input value={description} onChange={(e) => setDescription(e.target.value)} />
        </Field>
        <Field label="skills" hint="separadas por coma">
          <Input value={skills} onChange={(e) => setSkills(e.target.value)} placeholder="code-review, git" />
        </Field>
        <Field label="tools" hint="separadas por coma">
          <Input value={tools} onChange={(e) => setTools(e.target.value)} placeholder="read, write, run" />
        </Field>
        <Field label="body" hint="markdown — extiende el system prompt del agente">
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
