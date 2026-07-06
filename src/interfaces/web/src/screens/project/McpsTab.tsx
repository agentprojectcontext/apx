import { useEffect, useMemo, useRef, useState } from "react";
import useSWR from "swr";
import {
  ChevronDown, FlaskConical, Globe, Network, Pencil, Plus, ScrollText,
  Terminal, Trash2, Wrench, X, XCircle,
} from "lucide-react";
import { Mcps, Vars, type McpAddBody, type McpScope, type McpLogsResult, type VarsList } from "../../lib/api";
import type { McpEntry } from "../../types/daemon";
import { cn } from "../../lib/cn";
import { Section } from "../../components/Section";
import { Badge, Button, Dialog, Empty, Field, Input, Loading, Switch } from "../../components/ui";
import { Tip } from "../../components/ui/tip";
import { UiSelect } from "../../components/UiSelect";
import { VarTokenInput } from "../../components/inputs/VarTokenInput";
import { KeyValueList, recordFromRows, rowsFromRecord, type KvRow } from "../../components/inputs/KeyValueList";
import { useToast } from "../../components/Toast";
import { t } from "../../i18n";

type DialogMode =
  | null
  | { kind: "new" }
  | { kind: "edit"; entry: McpEntry };

// Per-row live test state: mirrors PandaProject's MCP cards — a colored dot +
// tool count come from the last on-demand test (tools/list) of each server.
type McpResult = { busy?: boolean; ok?: boolean; error?: string; tools?: { name: string; description: string }[] };

// Short one-liner describing how a server connects (http url or stdio command),
// shown under the name like Panda's config summary. Prefers an explicit
// description in the raw config when present.
function mcpSummary(m: McpEntry): string {
  const raw = (m as unknown as { raw?: Record<string, unknown> }).raw || {};
  if (typeof raw.description === "string" && raw.description.trim()) return raw.description.trim();
  if (m.transport === "http" && m.url) return m.url.length > 64 ? m.url.slice(0, 61) + "…" : m.url;
  const cmd = [m.command, ...(m.args || [])].filter(Boolean).join(" ");
  if (cmd) return "$ " + (cmd.length > 64 ? cmd.slice(0, 61) + "…" : cmd);
  return "";
}

// Colored status dot: red on a failed test, emerald when tested-ok or enabled,
// muted when disabled, amber while testing.
function dotClass(enabled: boolean, res?: McpResult): string {
  if (res?.busy) return "bg-amber-400 animate-pulse";
  if (res?.ok === false) return "bg-red-400";
  if (res?.ok) return "bg-emerald-400";
  return enabled ? "bg-emerald-500/70" : "bg-slate-500";
}

const SOURCE_TONE: Record<string, "info" | "muted" | "success"> = {
  apc: "info",
  runtime: "success",
  global: "muted",
};

function sourceToScope(source: string): McpScope {
  if (source === "runtime") return "runtime";
  if (source === "global") return "global";
  return "shared";
}

function sourceLabel(source: string): string {
  if (source === "runtime") return t("project.mcps.source_runtime");
  if (source === "apc") return t("project.mcps.source_apc");
  if (source === "claude") return t("project.mcps.source_claude");
  if (source === "codex") return t("project.mcps.source_codex");
  if (source === "cursor") return t("project.mcps.source_cursor");
  if (source === "vscode") return t("project.mcps.source_vscode");
  if (source === "roo") return t("project.mcps.source_roo");
  if (source === "gemini") return t("project.mcps.source_gemini");
  if (source === "global") return t("project.mcps.scope_global");
  return source;
}

export function McpsTab({ pid }: { pid: string }) {
  const toast = useToast();
  const list = useSWR(`/projects/${pid}/mcps`, () => Mcps.list(pid));
  const conflicts = useSWR(`/projects/${pid}/mcps/check`, () => Mcps.check(pid));
  const vars = useSWR<VarsList>(`/projects/${pid}/vars`, () => Vars.list(pid));
  const [dialog, setDialog] = useState<DialogMode>(null);
  const [activeMcp, setActiveMcp] = useState<string | null>(null);
  const [results, setResults] = useState<Record<string, McpResult>>({});
  const [expandedTools, setExpandedTools] = useState<Record<string, boolean>>({});

  const varNames = useMemo(
    () => (vars.data ? Object.keys(vars.data.effective).sort() : []),
    [vars.data],
  );

  const remove = async (name: string, scope: McpScope) => {
    if (!confirm(t("project.mcps.delete_confirm", { name, scope }))) return;
    try { await Mcps.remove(pid, name, scope); toast.success(t("project.mcps.removed")); list.mutate(); if (activeMcp === name) setActiveMcp(null); }
    catch (e: any) { toast.error(e?.message || t("common.error_generic")); }
  };

  const toggleEnabled = async (m: McpEntry) => {
    try {
      await Mcps.add(pid, sourceToScope(m.source), { name: m.name, enabled: !m.enabled });
      list.mutate();
    } catch (e: any) {
      toast.error(e?.message || t("common.error_generic"));
    }
  };

  const runTest = async (name: string) => {
    setActiveMcp(name);
    setResults((prev) => ({ ...prev, [name]: { busy: true } }));
    setExpandedTools((prev) => ({ ...prev, [name]: true }));
    try {
      const result = await Mcps.test(pid, name);
      setResults((prev) => ({ ...prev, [name]: { ok: result.ok, error: result.error, tools: result.tools } }));
    } catch (e: any) {
      setResults((prev) => ({ ...prev, [name]: { ok: false, error: e?.message || "error" } }));
    }
  };

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-4">
      <div className="lg:col-span-3">
        <Section
          title={t("project.mcps.title")}
          description={t("project.mcps.subtitle")}
          action={<Button size="sm" variant="primary" onClick={() => setDialog({ kind: "new" })}><Plus size={14} /> {t("project.mcps.new")}</Button>}
        >
          {conflicts.data?.conflicts?.length ? (
            <div className="mb-3 rounded-md border border-amber-500/40 bg-amber-500/10 p-2 text-xs">
              <div className="font-medium">
                {t("project.mcps.conflicts", { names: conflicts.data.conflicts.map((c) => c.name).join(", ") })}
              </div>
              <ul className="mt-1 space-y-1 text-muted-fg">
                {conflicts.data.conflicts.map((c) => (
                  <li key={`${c.name}-${c.winner}-${c.loser}`} className="flex gap-2">
                    <span aria-hidden="true">•</span>
                    <span>
                      {t("project.mcps.conflict_detail", {
                        name: c.name,
                        winner: sourceLabel(c.winner),
                        loser: sourceLabel(c.loser),
                      })}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {list.isLoading && <Loading />}
          {!list.isLoading && (list.data?.length ?? 0) === 0 && <Empty>{t("project.mcps.empty")}</Empty>}

          <ul className="space-y-2 text-sm">
            {(list.data || []).map((m) => {
              const writable = m.source === "apc" || m.source === "runtime" || m.source === "global";
              const scopeForRemove: McpScope = sourceToScope(m.source);
              const isActive = activeMcp === m.name;
              const enabled = m.enabled !== false;
              const res = results[m.name];
              const tools = res?.tools || [];
              const open = !!expandedTools[m.name];
              const summary = mcpSummary(m);
              const Icon = m.transport === "http" ? Globe : Network;
              return (
                <li
                  key={`${m.source}-${m.name}`}
                  className={
                    "rounded-md border px-3 py-2 transition-colors " +
                    (isActive ? "border-primary/50 bg-primary/5" : "border-border bg-muted/30 hover:bg-muted/50")
                  }
                  onClick={() => setActiveMcp(m.name)}
                  role="button"
                >
                  <div className="flex items-start gap-3">
                    {/* Icon + colored status dot */}
                    <div className="relative mt-0.5 flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg border border-border bg-background">
                      <Icon size={16} className="text-muted-fg" />
                      <span className={cn("absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full border-2 border-card", dotClass(enabled, res))} />
                    </div>

                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-medium">{m.name}</span>
                        <Badge tone={SOURCE_TONE[m.source] ?? "muted"}>{sourceLabel(m.source)}</Badge>
                        <span className="ml-auto text-xs text-muted-fg">{(m.transport || "stdio").toUpperCase()}</span>
                        <div onClick={(e) => e.stopPropagation()}>
                          <Switch checked={enabled} onChange={() => toggleEnabled(m)} label="" />
                        </div>
                        <Tip content={t("project.mcps.test_btn")}>
                          <Button size="sm" variant="ghost" onClick={(e) => { e.stopPropagation(); runTest(m.name); }} aria-label={t("project.mcps.test_btn")}>
                            {res?.busy ? <FlaskConical size={13} className="animate-pulse" /> : <FlaskConical size={13} />}
                          </Button>
                        </Tip>
                        <Tip content={t("project.mcps.logs_btn")}>
                          <Button size="sm" variant="ghost" onClick={(e) => { e.stopPropagation(); setActiveMcp(m.name); }} aria-label={t("project.mcps.logs_btn")}>
                            <ScrollText size={13} />
                          </Button>
                        </Tip>
                        {writable && (
                          <Tip content={t("project.mcps.edit_btn")}>
                            <Button size="sm" variant="ghost" onClick={(e) => { e.stopPropagation(); setDialog({ kind: "edit", entry: m }); }} aria-label={t("project.mcps.edit_btn")}>
                              <Pencil size={13} />
                            </Button>
                          </Tip>
                        )}
                        {writable && (
                          <Button size="sm" variant="destructive" onClick={(e) => { e.stopPropagation(); remove(m.name, scopeForRemove); }}>
                            <Trash2 size={13} />
                          </Button>
                        )}
                      </div>

                      {summary && <p className="mt-0.5 truncate font-mono text-xs text-muted-fg">{summary}</p>}

                      {res?.ok === false && res.error && (
                        <p className="mt-1 flex items-start gap-1 text-xs text-red-400">
                          <XCircle size={12} className="mt-0.5 flex-shrink-0" /> <span className="break-words">{res.error}</span>
                        </p>
                      )}

                      {tools.length > 0 && (
                        <div className="mt-1.5" onClick={(e) => e.stopPropagation()}>
                          <button
                            type="button"
                            onClick={() => setExpandedTools((prev) => ({ ...prev, [m.name]: !prev[m.name] }))}
                            className="flex items-center gap-1 text-xs text-muted-fg transition-colors hover:text-fg"
                          >
                            <Wrench size={12} /> {t("project.mcps.tools_count", { n: tools.length })}
                            <ChevronDown size={12} className={cn("transition-transform", open && "rotate-180")} />
                          </button>
                          {open && (
                            <div className="mt-1.5 flex flex-wrap gap-1.5">
                              {tools.slice(0, 40).map((tool) => (
                                <Tip key={tool.name} content={tool.description || "—"}>
                                  <span className="inline-flex items-center gap-1 rounded border border-border bg-background px-1.5 py-0.5 font-mono text-[10px] text-muted-fg">
                                    <Terminal size={10} /> {tool.name}
                                  </span>
                                </Tip>
                              ))}
                              {tools.length > 40 && <span className="text-[10px] text-muted-fg">… +{tools.length - 40}</span>}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>

          {dialog && (
            <UpsertMcpDialog
              mode={dialog}
              pid={pid}
              varNames={varNames}
              onClose={() => setDialog(null)}
              onSaved={() => { setDialog(null); list.mutate(); }}
              onVarsChanged={() => vars.mutate()}
            />
          )}
        </Section>
      </div>

      <div className="lg:col-span-1">
        <LogsPanel pid={pid} mcpName={activeMcp} runningTest={!!(activeMcp && results[activeMcp]?.busy)} />
      </div>
    </div>
  );
}


// Right-side terminal-style live logs panel. Polls the daemon every 1.5s
// while a test is running (or every 4s when idle and an MCP is pinned) so
// the user can see fetch/exit events as they happen without clicking Logs.
function LogsPanel({
  pid,
  mcpName,
  runningTest,
}: { pid: string; mcpName: string | null; runningTest: boolean }) {
  const [data, setData] = useState<McpLogsResult | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const lastNameRef = useRef<string | null>(null);

  useEffect(() => {
    if (!mcpName) { setData(null); setErr(null); return; }
    if (lastNameRef.current !== mcpName) {
      setData(null);
      setErr(null);
      lastNameRef.current = mcpName;
    }
    let cancelled = false;
    const fetchOnce = async () => {
      try {
        const d = await Mcps.logs(pid, mcpName);
        if (!cancelled) { setData(d); setErr(null); }
      } catch (e: any) {
        if (!cancelled) setErr(e?.message || "error");
      }
    };
    fetchOnce();
    const interval = runningTest ? 1200 : 4000;
    const handle = setInterval(fetchOnce, interval);
    return () => { cancelled = true; clearInterval(handle); };
  }, [pid, mcpName, runningTest]);

  // Auto-scroll the terminal to the bottom when new events arrive.
  const termRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (termRef.current) termRef.current.scrollTop = termRef.current.scrollHeight;
  }, [data?.events?.length, data?.stderr_tail]);

  return (
    <div className="sticky top-3 flex h-[calc(100vh-7rem)] min-h-[24rem] flex-col rounded-xl border border-border bg-card">
      <div className="flex items-center gap-2 border-b border-border px-3 py-2 text-xs">
        <Terminal size={13} className="text-muted-fg" />
        <span className="font-medium">{t("project.mcps.logs_panel_title")}</span>
        {mcpName ? (
          <Badge tone="info">{mcpName}</Badge>
        ) : (
          <span className="text-muted-fg">— {t("project.mcps.logs_panel_pick")}</span>
        )}
      </div>
      <div ref={termRef} className="flex-1 overflow-auto bg-background/60 px-3 py-2 font-mono text-[11px]">
        {!mcpName && (
          <p className="text-muted-fg">{t("project.mcps.logs_panel_hint")}</p>
        )}
        {mcpName && err && (
          <p className="text-red-400">{err}</p>
        )}
        {mcpName && !err && data && (
          <>
            <div className="mb-2 text-muted-fg">
              {data.transport.toUpperCase()}{data.url ? ` · ${data.url}` : data.command ? ` · ${data.command}` : ""}
              {data.last_error ? ` · last_error: ${data.last_error}` : ""}
            </div>
            {data.note && <p className="text-muted-fg">{data.note}</p>}
            {(!data.events || data.events.length === 0) && !data.stderr_tail && !data.note && (
              <p className="text-muted-fg">{t("project.mcps.logs_panel_idle")}</p>
            )}
            {data.events?.map((e, i) => (
              <div key={i} className="flex gap-2">
                <span className="text-muted-fg">{e.ts.slice(11, 19)}</span>
                <span className={
                  e.level === "error" ? "text-red-400"
                  : e.level === "stderr" ? "text-amber-400"
                  : "text-emerald-400"
                }>{e.level}</span>
                <span className="flex-1 break-all">{e.msg}</span>
              </div>
            ))}
            {data.stderr_tail && (
              <div className="mt-2 border-t border-border/60 pt-2">
                <div className="mb-1 text-muted-fg">stderr</div>
                <pre className="whitespace-pre-wrap break-all text-amber-300/80">{data.stderr_tail}</pre>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

// -- Upsert dialog -----------------------------------------------------------

interface UpsertProps {
  mode: { kind: "new" } | { kind: "edit"; entry: McpEntry };
  pid: string;
  varNames: string[];
  onClose: () => void;
  onSaved: () => void;
  onVarsChanged: () => void;
}

function UpsertMcpDialog({ mode, pid, varNames, onClose, onSaved, onVarsChanged }: UpsertProps) {
  const toast = useToast();
  const isEdit = mode.kind === "edit";
  const initial = isEdit ? mode.entry : null;

  const [busy, setBusy] = useState(false);
  const [scope, setScope] = useState<McpScope>(initial ? sourceToScope(initial.source) : "runtime");
  const [name, setName] = useState(initial?.name || "");
  const [transport, setTransport] = useState<"stdio" | "http">(
    (initial?.transport === "http" || !!initial?.url) ? "http" : "stdio",
  );
  const [command, setCommand] = useState(initial?.command || "");
  const [args, setArgs] = useState<string[]>(initial?.args && initial.args.length ? initial.args : [""]);
  const [envRows, setEnvRows] = useState<KvRow[]>(rowsFromRecord(initial?.env));
  const [url, setUrl] = useState(initial?.url || "");
  const [headerRows, setHeaderRows] = useState<KvRow[]>(rowsFromRecord(initial?.headers));
  const [enabled, setEnabled] = useState(initial?.enabled !== false);
  const [createVarOpen, setCreateVarOpen] = useState(false);

  const submit = async () => {
    if (!name.trim()) { toast.error(t("project.mcps.name_required")); return; }
    setBusy(true);
    try {
      const cleanArgs = args.map((a) => a.trim()).filter(Boolean);
      const body: McpAddBody =
        transport === "stdio"
          ? {
              name: name.trim(),
              command: command.trim(),
              args: cleanArgs.length ? cleanArgs : undefined,
              env: envRows.length ? recordFromRows(envRows) : undefined,
              enabled,
            }
          : {
              name: name.trim(),
              url: url.trim(),
              headers: headerRows.length ? recordFromRows(headerRows) : undefined,
              enabled,
            };
      await Mcps.add(pid, scope, body);
      toast.success(isEdit ? t("project.mcps.updated") : t("project.mcps.added"));
      onSaved();
    } catch (e: any) {
      toast.error(e?.message || t("common.error_generic"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Dialog
        open
        onClose={() => (busy ? null : onClose())}
        title={isEdit ? t("project.mcps.edit_title") : t("project.mcps.new_title")}
        description={isEdit ? initial?.name : t("project.mcps.new_desc")}
        size="lg"
        footer={
          <>
            <Button variant="ghost" onClick={onClose} disabled={busy}>{t("common.cancel")}</Button>
            <Button variant="primary" onClick={submit} loading={busy}>
              {isEdit ? t("project.mcps.save_btn") : t("project.mcps.add_btn")}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <Field label={t("project.mcps.scope_label")}>
              <UiSelect
                value={scope}
                onChange={(v) => setScope(v as McpScope)}
                options={[
                  { value: "runtime", label: t("project.mcps.scope_runtime"), description: t("project.mcps.scope_runtime_desc") },
                  { value: "shared",  label: t("project.mcps.scope_shared"),  description: t("project.mcps.scope_shared_desc") },
                  { value: "global",  label: t("project.mcps.scope_global"),  description: t("project.mcps.scope_global_desc") },
                ]}
              />
            </Field>
            <Field label={t("project.mcps.transport_label")}>
              <UiSelect
                value={transport}
                onChange={(v) => setTransport(v as "stdio" | "http")}
                options={[
                  { value: "stdio", label: t("project.mcps.transport_stdio"), description: t("project.mcps.transport_stdio_desc") },
                  { value: "http",  label: t("project.mcps.transport_http"),  description: t("project.mcps.transport_http_desc") },
                ]}
              />
            </Field>
          </div>

          <Field label={t("project.mcps.name_label")}>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t("project.mcps.name_ph")}
              disabled={isEdit}
            />
          </Field>

          {transport === "stdio" ? (
            <>
              <Field label={t("project.mcps.cmd_label")}>
                <Input value={command} onChange={(e) => setCommand(e.target.value)} placeholder={t("project.mcps.cmd_ph")} />
              </Field>
              <Field label={t("project.mcps.args_label")} hint={t("project.mcps.args_hint_tokens")}>
                <ArgsList
                  args={args}
                  onChange={setArgs}
                  varNames={varNames}
                  onCreateVar={() => setCreateVarOpen(true)}
                />
              </Field>
              <Field label={t("project.mcps.env_label")} hint={t("project.mcps.env_hint_tokens")}>
                <KeyValueList
                  rows={envRows}
                  onChange={setEnvRows}
                  keyPlaceholder="API_KEY"
                  valuePlaceholder="${var.MY_TOKEN}"
                  varNames={varNames}
                  onCreateVar={() => setCreateVarOpen(true)}
                  emptyLabel={t("project.mcps.env_empty")}
                />
              </Field>
            </>
          ) : (
            <>
              <Field label={t("project.mcps.url_label")}>
                <VarTokenInput
                  value={url}
                  onChange={setUrl}
                  placeholder={t("project.mcps.url_ph")}
                  varNames={varNames}
                  onCreateVar={() => setCreateVarOpen(true)}
                />
              </Field>
              <Field label={t("project.mcps.headers_label")} hint={t("project.mcps.headers_hint")}>
                <KeyValueList
                  rows={headerRows}
                  onChange={setHeaderRows}
                  keyPlaceholder="Authorization"
                  valuePlaceholder="Bearer ${var.TOKEN}"
                  varNames={varNames}
                  onCreateVar={() => setCreateVarOpen(true)}
                  emptyLabel={t("project.mcps.headers_empty")}
                />
              </Field>
            </>
          )}

          <Switch checked={enabled} onChange={setEnabled} label={t("project.mcps.enabled_label")} />
        </div>
      </Dialog>

      {createVarOpen && (
        <QuickCreateVarDialog
          pid={pid}
          onClose={() => setCreateVarOpen(false)}
          onCreated={() => {
            setCreateVarOpen(false);
            onVarsChanged();
          }}
        />
      )}
    </>
  );
}

function ArgsList({
  args,
  onChange,
  varNames,
  onCreateVar,
}: {
  args: string[];
  onChange: (next: string[]) => void;
  varNames: string[];
  onCreateVar: () => void;
}) {
  const update = (i: number, v: string) => {
    const next = args.slice();
    next[i] = v;
    onChange(next);
  };
  const remove = (i: number) => onChange(args.filter((_, j) => j !== i));
  const add = () => onChange([...args, ""]);
  return (
    <div className="space-y-2">
      {args.map((a, i) => (
        <div key={i} className="flex items-start gap-2">
          <div className="flex-1">
            <VarTokenInput
              value={a}
              onChange={(v) => update(i, v)}
              placeholder={t("agents_ui.arg_placeholder")}
              varNames={varNames}
              onCreateVar={onCreateVar}
            />
          </div>
          <Button type="button" size="sm" variant="ghost" onClick={() => remove(i)} aria-label={t("agents_ui.remove_arg")}>
            <Trash2 size={13} />
          </Button>
        </div>
      ))}
      <Button type="button" size="sm" variant="ghost" onClick={add}>
        <Plus size={12} /> {t("project.mcps.add_arg")}
      </Button>
    </div>
  );
}

function QuickCreateVarDialog({
  pid,
  onClose,
  onCreated,
}: { pid: string; onClose: () => void; onCreated: () => void }) {
  const toast = useToast();
  const isBase = String(pid) === "0";
  const [name, setName] = useState("");
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [scope, setScope] = useState<"project" | "global">(isBase ? "global" : "project");
  const submit = async () => {
    if (!name.trim()) { toast.error(t("project.vars.name_required")); return; }
    if (!value) { toast.error(t("project.vars.value_required")); return; }
    setBusy(true);
    try {
      await Vars.upsert(pid, { name: name.trim(), value, scope });
      toast.success(t("project.vars.added"));
      onCreated();
    } catch (e: any) {
      toast.error(e?.message || t("common.error_generic"));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog
      open
      onClose={() => (busy ? null : onClose())}
      title={t("project.vars.new_title")}
      description={t("project.vars.new_desc")}
      size="sm"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>{t("common.cancel")}</Button>
          <Button variant="primary" onClick={submit} loading={busy}>{t("project.vars.add_btn")}</Button>
        </>
      }
    >
      <div className="space-y-3">
        <Field label={t("project.vars.scope_label")}>
          <UiSelect
            value={scope}
            onChange={(v) => setScope(v as "project" | "global")}
            options={[
              ...(isBase ? [] : [{ value: "project", label: t("project.vars.scope_project"), description: t("project.vars.scope_project_desc") }]),
              { value: "global", label: t("project.vars.scope_global"), description: t("project.vars.scope_global_desc") },
            ]}
          />
        </Field>
        <Field label={t("project.vars.name_label")} hint={t("project.vars.name_hint")}>
          <Input
            value={name}
            onChange={(e) => setName(e.target.value.toUpperCase().replace(/[^A-Z0-9_]/g, "_"))}
            placeholder="MY_API_KEY"
            autoFocus
          />
        </Field>
        <Field label={t("project.vars.value_label")} hint={t("project.vars.value_hint")}>
          <Input
            type="password"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            className="font-mono text-xs"
          />
        </Field>
      </div>
    </Dialog>
  );
}
