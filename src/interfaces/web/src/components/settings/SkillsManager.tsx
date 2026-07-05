import { useMemo, useRef, useState, type ReactNode } from "react";
import useSWR from "swr";
import {
  ChevronDown, Code2, FileText, GitBranch, Lock, PencilLine,
  Plus, RotateCcw, Trash2, Upload,
} from "lucide-react";
import { Button, Field, Input, Textarea, Switch, Badge, Loading, Tip, Dialog } from "../ui";
import { UiSelect } from "../UiSelect";
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem,
} from "../ui/dropdown-menu";
import { useToast } from "../Toast";
import { Skills, type SkillEntry } from "../../lib/api/skills";
import { Projects } from "../../lib/api/projects";
import { t } from "../../i18n";

// Claude-Desktop-style skills manager: a left list of installed skills + a right
// viewer that renders the selected SKILL.md, with per-scope on/off, delete, and
// an "Add" dropdown (create online / upload .zip / clone git repo).
//
// Scope: "default" = the super-agent baseline; a project path = that project.
// Reusable with a FIXED scope (embedded in a project screen) or a SELECTABLE
// scope (the global settings tab, which shows a scope picker).

const SUPER = "default";

function basename(p: string): string {
  const parts = p.replace(/\/+$/, "").split("/");
  return parts[parts.length - 1] || p;
}

function sourceBadge(source: string): { label: string; tone: "info" | "success" | "muted" } {
  if (source === "builtin") return { label: t("skills_page.source_builtin"), tone: "info" };
  if (source === "project") return { label: t("skills_page.source_project"), tone: "success" };
  return { label: t("skills_page.source_global"), tone: "muted" };
}

// ---------------------------------------------------------------------------
// Minimal Markdown renderer (no dependency) — headings, lists, code, bold.
// ---------------------------------------------------------------------------

function inline(s: string): ReactNode {
  const parts: ReactNode[] = [];
  const re = /(\*\*[^*]+\*\*|`[^`]+`)/g;
  let last = 0, m: RegExpExecArray | null, k = 0;
  while ((m = re.exec(s))) {
    if (m.index > last) parts.push(s.slice(last, m.index));
    const tok = m[0];
    if (tok.startsWith("**")) parts.push(<strong key={k++}>{tok.slice(2, -2)}</strong>);
    else parts.push(<code key={k++} className="rounded bg-muted px-1 py-0.5 text-[0.85em]">{tok.slice(1, -1)}</code>);
    last = m.index + tok.length;
  }
  if (last < s.length) parts.push(s.slice(last));
  return parts;
}

function renderMarkdown(md: string): ReactNode {
  const lines = md.split("\n");
  const out: ReactNode[] = [];
  let i = 0, key = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (line.trim().startsWith("```")) {
      const buf: string[] = [];
      i++;
      while (i < lines.length && !lines[i].trim().startsWith("```")) { buf.push(lines[i]); i++; }
      i++;
      out.push(
        <pre key={key++} className="my-2 overflow-x-auto rounded-md border border-border bg-muted/50 p-3 text-xs">
          <code>{buf.join("\n")}</code>
        </pre>,
      );
      continue;
    }
    const h = line.match(/^(#{1,4})\s+(.*)$/);
    if (h) {
      const lvl = h[1].length;
      const cls = lvl === 1 ? "mt-4 mb-1 text-lg font-semibold"
        : lvl === 2 ? "mt-3 mb-1 text-base font-semibold"
        : "mt-2 mb-0.5 text-sm font-semibold";
      out.push(<div key={key++} className={cls}>{inline(h[2])}</div>);
      i++; continue;
    }
    if (/^\s*[-*]\s+/.test(line)) {
      const items: ReactNode[] = [];
      while (i < lines.length && /^\s*[-*]\s+/.test(lines[i])) {
        items.push(<li key={items.length}>{inline(lines[i].replace(/^\s*[-*]\s+/, ""))}</li>);
        i++;
      }
      out.push(<ul key={key++} className="my-1 list-disc space-y-0.5 pl-5 text-sm">{items}</ul>);
      continue;
    }
    if (line.trim() === "") { i++; continue; }
    const buf: string[] = [];
    while (
      i < lines.length && lines[i].trim() !== "" &&
      !/^(#{1,4})\s/.test(lines[i]) && !/^\s*[-*]\s+/.test(lines[i]) &&
      !lines[i].trim().startsWith("```")
    ) { buf.push(lines[i]); i++; }
    out.push(<p key={key++} className="my-1.5 text-sm leading-relaxed">{inline(buf.join(" "))}</p>);
  }
  return out;
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).replace(/^data:.*;base64,/, ""));
    r.onerror = () => reject(new Error("read failed"));
    r.readAsDataURL(file);
  });
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

export function SkillsManager({ scope: fixedScope, selectable = false }: { scope?: string; selectable?: boolean }) {
  const toast = useToast();
  const [scopeState, setScopeState] = useState<string>(fixedScope ?? SUPER);
  const scope = fixedScope ?? scopeState;
  const projectPath = scope === SUPER ? undefined : scope;

  const [busy, setBusy] = useState(false);
  const [picked, setPicked] = useState<string | null>(null);
  const [view, setView] = useState<"preview" | "source">("preview");
  const [createOpen, setCreateOpen] = useState(false);
  const [repoOpen, setRepoOpen] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const { data: projects } = useSWR(selectable ? "/projects" : null, () => Projects.list());
  const scopeOptions = useMemo(() => [
    { value: SUPER, label: t("skills_page.scope_super_agent") },
    ...(projects ?? []).map((p) => ({ value: p.path, label: p.name || basename(p.path) })),
  ], [projects]);

  const { data, mutate, isLoading } = useSWR(["/skills", scope], () => Skills.list(projectPath));
  const skills = useMemo(() => data?.skills ?? [], [data]);
  const onCount = skills.filter((s) => s.enabled !== false).length;

  // Derived selection: keep the picked slug if still present, else first.
  const selected = picked && skills.some((s) => s.slug === picked) ? picked : (skills[0]?.slug ?? null);
  const { data: detail } = useSWR(
    selected ? ["/skill-detail", scope, selected] : null,
    () => Skills.detail(selected!, projectPath),
  );

  const setEnabled = async (slug: string, enabled: boolean | null) => {
    setBusy(true);
    try { await Skills.setEnabled({ slug, enabled, scope }); await mutate(); }
    catch (e) { toast.error(t("skills_page.toggle_failed", { msg: (e as Error).message })); }
    finally { setBusy(false); }
  };

  const remove = async (slug: string) => {
    if (!window.confirm(t("skills_page.delete_confirm", { slug }))) return;
    setBusy(true);
    try {
      await Skills.remove(slug, projectPath);
      toast.success(t("skills_page.deleted_ok", { slug }));
      if (picked === slug) setPicked(null);
      await mutate();
    } catch (e) { toast.error(t("skills_page.delete_failed", { msg: (e as Error).message })); }
    finally { setBusy(false); }
  };

  const afterAdd = async (slug: string, okMsg: string) => {
    toast.success(okMsg);
    setPicked(slug);
    await mutate();
  };

  const createSkill = async (slug: string, description: string, body: string) => {
    await Skills.create({ slug, description, body, project_path: projectPath });
    await afterAdd(slug, t("skills_page.created_ok", { slug }));
  };
  const importRepo = async (url: string) => {
    const r = await Skills.importRepo({ url, project_path: projectPath });
    await afterAdd(r.slug, t("skills_page.imported_ok", { slug: r.slug }));
  };
  const onPickZip = async (file: File | undefined) => {
    if (!file) return;
    setBusy(true);
    try {
      const data64 = await fileToBase64(file);
      const r = await Skills.importZip({ data: data64, project_path: projectPath });
      await afterAdd(r.slug, t("skills_page.imported_ok", { slug: r.slug }));
    } catch (e) { toast.error(t("skills_page.import_failed", { msg: (e as Error).message })); }
    finally { setBusy(false); if (fileRef.current) fileRef.current.value = ""; }
  };

  return (
    <div className="space-y-4">
      {/* Header: scope + count + Add */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3">
          {selectable ? (
            <div className="w-64">
              <UiSelect value={scope} onChange={(v) => { setScopeState(v); setPicked(null); }}
                options={scopeOptions} placeholder={t("skills_page.scope_ph")} />
            </div>
          ) : null}
          <Badge tone="muted">{t("skills_page.count_label", { n: skills.length, on: onCount })}</Badge>
        </div>

        <DropdownMenu>
          <DropdownMenuTrigger
            disabled={busy}
            className="inline-flex h-9 items-center gap-1.5 rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
          >
            <Plus size={15} /> {t("skills_page.add_menu")} <ChevronDown size={14} />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" sideOffset={6} className="w-72">
            <DropdownMenuItem onClick={() => setCreateOpen(true)}>
              <PencilLine size={15} className="text-muted-fg" />
              <AddItemLabel title={t("skills_page.add_online")} hint={t("skills_page.add_online_hint")} />
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => fileRef.current?.click()}>
              <Upload size={15} className="text-muted-fg" />
              <AddItemLabel title={t("skills_page.add_zip")} hint={t("skills_page.add_zip_hint")} />
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => setRepoOpen(true)}>
              <GitBranch size={15} className="text-muted-fg" />
              <AddItemLabel title={t("skills_page.add_repo")} hint={t("skills_page.add_repo_hint")} />
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        <input ref={fileRef} type="file" accept=".zip" className="hidden"
          onChange={(e) => onPickZip(e.target.files?.[0])} />
      </div>

      {/* Body: list + viewer */}
      {isLoading || !data ? (
        <Loading />
      ) : (
        <div className="grid min-h-[62vh] gap-4 lg:grid-cols-[20rem_1fr]">
          {/* List */}
          <div className="overflow-hidden rounded-xl border border-border bg-card">
            <ul className="max-h-[62vh] divide-y divide-border overflow-y-auto">
              {skills.length === 0 ? (
                <li className="px-3 py-4 text-sm text-muted-fg">{t("skills_page.empty")}</li>
              ) : skills.map((s) => (
                <SkillRow key={s.slug} skill={s} active={s.slug === selected} busy={busy}
                  onSelect={() => setPicked(s.slug)}
                  onToggle={(v) => setEnabled(s.slug, v)} />
              ))}
            </ul>
          </div>

          {/* Viewer */}
          <div className="min-w-0 overflow-hidden rounded-xl border border-border bg-card">
            {!selected ? (
              <div className="grid h-full place-items-center p-8 text-sm text-muted-fg">
                {t("skills_page.select_a_skill")}
              </div>
            ) : !detail ? (
              <div className="p-6"><Loading /></div>
            ) : (
              <div className="flex h-full max-h-[62vh] flex-col">
                {/* Viewer header */}
                <div className="flex items-start justify-between gap-3 border-b border-border px-5 py-4">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <code className="text-sm font-semibold">{detail.slug}</code>
                      {(() => { const b = sourceBadge(detail.source); return <Badge tone={b.tone}>{b.label}</Badge>; })()}
                      {detail.private && (
                        <span className="inline-flex items-center gap-1 text-xs text-muted-fg">
                          <Lock size={11} /> {t("skills_page.private_badge")}
                        </span>
                      )}
                    </div>
                    {detail.description && (
                      <p className="mt-1 text-sm text-muted-fg">{detail.description}</p>
                    )}
                    <div className="mt-2 flex flex-wrap gap-x-6 gap-y-1 text-xs text-muted-fg">
                      <span>{t("skills_page.added_by")}: <span className="text-foreground">
                        {detail.private ? t("skills_page.by_apx") : t("skills_page.by_you")}</span></span>
                      <span>{t("skills_page.activator")}: <span className="text-foreground">
                        {t("skills_page.activator_value")}</span></span>
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    {(detail.source === "global" || detail.source === "project") && (
                      <Tip content={t("skills_page.delete_btn")}>
                        <Button variant="ghost" size="sm" disabled={busy}
                          onClick={() => remove(detail.slug)} aria-label={t("skills_page.delete_btn")}>
                          <Trash2 size={14} />
                        </Button>
                      </Tip>
                    )}
                    <Switch checked={detail.private ? true : detail.enabled}
                      disabled={busy || detail.private}
                      onChange={(v) => setEnabled(detail.slug, v)}
                      label={(detail.private ? true : detail.enabled) ? t("skills_page.on") : t("skills_page.off")} />
                  </div>
                </div>

                {/* View toggle */}
                <div className="flex items-center gap-1 border-b border-border px-4 py-2">
                  <ViewTab active={view === "preview"} onClick={() => setView("preview")}
                    icon={FileText} label={t("skills_page.tab_preview")} />
                  <ViewTab active={view === "source"} onClick={() => setView("source")}
                    icon={Code2} label={t("skills_page.tab_source")} />
                </div>

                {/* Body */}
                <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
                  {view === "preview" ? (
                    <div className="prose-none">{renderMarkdown(detail.body || "")}</div>
                  ) : (
                    <pre className="overflow-x-auto whitespace-pre-wrap break-words text-xs leading-relaxed text-muted-fg">
                      {detail.body}
                    </pre>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Dialogs */}
      <CreateDialog open={createOpen} onClose={() => setCreateOpen(false)}
        onCreate={createSkill} />
      <RepoDialog open={repoOpen} onClose={() => setRepoOpen(false)}
        onImport={importRepo} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function AddItemLabel({ title, hint }: { title: string; hint: string }) {
  return (
    <span className="flex min-w-0 flex-col leading-tight">
      <span className="font-medium">{title}</span>
      <span className="text-[11px] text-muted-fg">{hint}</span>
    </span>
  );
}

function ViewTab({ active, onClick, icon: Icon, label }: {
  active: boolean; onClick: () => void; icon: React.ElementType; label: string;
}) {
  return (
    <button type="button" onClick={onClick}
      className={`inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium transition ${
        active ? "bg-accent text-foreground" : "text-muted-fg hover:text-foreground"}`}>
      <Icon size={13} /> {label}
    </button>
  );
}

function SkillRow({ skill, active, busy, onSelect, onToggle }: {
  skill: SkillEntry; active: boolean; busy: boolean;
  onSelect: () => void; onToggle: (v: boolean) => void;
}) {
  const b = sourceBadge(skill.source);
  const enabled = skill.private ? true : skill.enabled !== false;
  return (
    <li>
      <div className={`flex items-center gap-2 px-3 py-2.5 ${active ? "bg-accent/50" : "hover:bg-accent/25"}`}>
        <button type="button" onClick={onSelect} className="min-w-0 flex-1 text-left">
          <div className="flex items-center gap-1.5">
            <code className="truncate text-[13px] font-medium">{skill.slug}</code>
            {skill.private && <Lock size={10} className="shrink-0 text-muted-fg" />}
          </div>
          <div className="mt-0.5 flex items-center gap-1.5">
            <Badge tone={b.tone}>{b.label}</Badge>
            {skill.overridden && <Badge tone="warning">{t("skills_page.overridden_badge")}</Badge>}
          </div>
        </button>
        <Switch checked={enabled} disabled={busy || skill.private} onChange={onToggle} />
      </div>
    </li>
  );
}

function CreateDialog({ open, onClose, onCreate }: {
  open: boolean; onClose: () => void;
  onCreate: (slug: string, description: string, body: string) => Promise<void>;
}) {
  const toast = useToast();
  const [slug, setSlug] = useState("");
  const [description, setDescription] = useState("");
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const valid = /^[a-z0-9][a-z0-9-]*$/.test(slug);

  const reset = () => { setSlug(""); setDescription(""); setBody(""); };
  const submit = async () => {
    if (!valid) return;
    setBusy(true);
    try { await onCreate(slug, description, body); reset(); onClose(); }
    catch (e) { toast.error(t("skills_page.create_failed", { msg: (e as Error).message })); }
    finally { setBusy(false); }
  };

  return (
    <Dialog open={open} onClose={onClose} title={t("skills_page.create_dialog_title")}
      description={t("skills_page.add_desc")} size="lg"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>{t("skills_page.cancel")}</Button>
          <Button variant="primary" onClick={submit} disabled={busy || !valid} loading={busy}>
            <Plus size={14} /> {t("skills_page.add_btn")}
          </Button>
        </>
      }>
      <div className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t("skills_page.add_slug_label")}>
            <Input value={slug} placeholder={t("skills_page.add_slug_ph")} disabled={busy}
              onChange={(e) => setSlug(e.target.value.toLowerCase())} />
          </Field>
          <Field label={t("skills_page.add_desc_label")}>
            <Input value={description} placeholder={t("skills_page.add_desc_ph")} disabled={busy}
              onChange={(e) => setDescription(e.target.value)} />
          </Field>
        </div>
        <Field label={t("skills_page.add_body_label")}>
          <Textarea value={body} placeholder={t("skills_page.add_body_ph")} disabled={busy} rows={10}
            onChange={(e) => setBody(e.target.value)} />
        </Field>
      </div>
    </Dialog>
  );
}

function RepoDialog({ open, onClose, onImport }: {
  open: boolean; onClose: () => void; onImport: (url: string) => Promise<void>;
}) {
  const toast = useToast();
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const valid = /^(https?:\/\/|git@|ssh:\/\/|git:\/\/)\S+$/.test(url.trim());

  const submit = async () => {
    if (!valid) return;
    setBusy(true);
    try { await onImport(url.trim()); setUrl(""); onClose(); }
    catch (e) { toast.error(t("skills_page.import_failed", { msg: (e as Error).message })); }
    finally { setBusy(false); }
  };

  return (
    <Dialog open={open} onClose={onClose} title={t("skills_page.repo_dialog_title")} size="md"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>{t("skills_page.cancel")}</Button>
          <Button variant="primary" onClick={submit} disabled={busy || !valid} loading={busy}>
            <GitBranch size={14} /> {t("skills_page.import_btn")}
          </Button>
        </>
      }>
      <Field label={t("skills_page.repo_url_label")} hint={t("skills_page.repo_url_hint")}>
        <Input value={url} placeholder={t("skills_page.repo_url_ph")} disabled={busy}
          onChange={(e) => setUrl(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") submit(); }} />
      </Field>
    </Dialog>
  );
}
