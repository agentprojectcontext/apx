import { useEffect, useMemo, useRef, useState } from "react";
import useSWR from "swr";
import {
  CheckCircle2, FlaskConical, Pencil, Plus, ScrollText, Terminal, Trash2, X, XCircle,
} from "lucide-react";
import { Mcps, Vars, type McpAddBody, type McpScope, type McpTestResult, type McpLogsResult, type VarsList } from "../../lib/api";
import type { McpEntry } from "../../types/daemon";
import { Section } from "../../components/Section";
import { Badge, Button, Dialog, Empty, Field, Input, Loading, Switch } from "../../components/ui";
import { UiSelect } from "../../components/UiSelect";
import { VarTokenInput } from "../../components/inputs/VarTokenInput";
import { KeyValueList, recordFromRows, rowsFromRecord, type KvRow } from "../../components/inputs/KeyValueList";
import { useToast } from "../../components/Toast";
import { t } from "../../i18n";

type DialogMode =
  | null
  | { kind: "new" }
  | { kind: "edit"; entry: McpEntry };

const SOURCE_LABEL: Record<string, string> = {
  apc: "Shared",
  runtime: "Runtime",
  global: "Global",
};

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
  return SOURCE_LABEL[source] ?? source;
}

export function McpsTab({ pid }: { pid: string }) {
  const toast = useToast();
  const list = useSWR(`/projects/${pid}/mcps`, () => Mcps.list(pid));
  const conflicts = useSWR(`/projects/${pid}/mcps/check`, () => Mcps.check(pid));
  const vars = useSWR<VarsList>(`/projects/${pid}/vars`, () => Vars.list(pid));
  const [dialog, setDialog] = useState<DialogMode>(null);
  const [activeMcp, setActiveMcp] = useState<string | null>(null);
  const [testFor, setTestFor] = useState<{ name: string; result?: McpTestResult; busy?: boolean } | null>(null);

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
    setTestFor({ name, busy: true });
    try {
      const result = await Mcps.test(pid, name);
      setTestFor({ name, result });
    } catch (e: any) {
      setTestFor({ name, result: { ok: false, error: e?.message || "error" } });
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
              {t("project.mcps.conflicts", { names: conflicts.data.conflicts.map((c: any) => c.name).join(", ") })}
            </div>
          ) : null}

          {list.isLoading && <Loading />}
          {!list.isLoading && (list.data?.length ?? 0) === 0 && <Empty>{t("project.mcps.empty")}</Empty>}

          <ul className="space-y-2 text-sm">
            {(list.data || []).map((m) => {
              const writable = m.source === "apc" || m.source === "runtime" || m.source === "global";
              const scopeForRemove: McpScope = sourceToScope(m.source);
              const isActive = activeMcp === m.name;
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
                  <div className="flex flex-wrap items-center gap-3">
                    <span className="font-medium">{m.name}</span>
                    <Badge tone={SOURCE_TONE[m.source] ?? "muted"} >{sourceLabel(m.source)}</Badge>
                    <span className="ml-auto text-xs text-muted-fg">
                      {(m.transport || "stdio").toUpperCase()}
                    </span>
                    <div onClick={(e) => e.stopPropagation()}>
                      <Switch
                        checked={m.enabled !== false}
                        onChange={() => toggleEnabled(m)}
                        label=""
                      />
                    </div>
                    <Button size="sm" variant="ghost" onClick={(e) => { e.stopPropagation(); runTest(m.name); }} aria-label={t("project.mcps.test_btn")} title={t("project.mcps.test_btn")}>
                      <FlaskConical size={13} />
                    </Button>
                    <Button size="sm" variant="ghost" onClick={(e) => { e.stopPropagation(); setActiveMcp(m.name); }} aria-label={t("project.mcps.logs_btn")} title={t("project.mcps.logs_btn")}>
                      <ScrollText size={13} />
                    </Button>
                    {writable && (
                      <Button size="sm" variant="ghost" onClick={(e) => { e.stopPropagation(); setDialog({ kind: "edit", entry: m }); }} aria-label={t("project.mcps.edit_btn")} title={t("project.mcps.edit_btn")}>
                        <Pencil size={13} />
                      </Button>
                    )}
                    {writable && (
                      <Button size="sm" variant="destructive" onClick={(e) => { e.stopPropagation(); remove(m.name, scopeForRemove); }}>
                        <Trash2 size={13} />
                      </Button>
                    )}
                  </div>
                  {testFor?.name === m.name && (
                    <TestResultRow result={testFor.result} busy={!!testFor.busy} onClose={() => setTestFor(null)} />
                  )}
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
        <LogsPanel pid={pid} mcpName={activeMcp} runningTest={!!testFor?.busy} />
      </div>
    </div>
  );
}

function TestResultRow({
  result,
  busy,
  onClose,
}: { result?: McpTestResult; busy: boolean; onClose: () => void }) {
  return (
    <div className="mt-2 rounded border border-border/60 bg-background/40 p-2 text-xs">
      <div className="mb-1 flex items-center gap-2">
        {busy && <span className="text-muted-fg">{t("project.mcps.testing")}</span>}
        {!busy && result?.ok && (
          <span className="flex items-center gap-1 text-emerald-400">
            <CheckCircle2 size={12} /> {t("project.mcps.test_ok", { n: String(result.tool_count ?? 0) })}
          </span>
        )}
        {!busy && result && !result.ok && (
          <span className="flex items-center gap-1 text-red-400">
            <XCircle size={12} /> {result.error}
          </span>
        )}
        <button className="ml-auto text-muted-fg hover:text-fg" onClick={onClose}>×</button>
      </div>
      {!busy && result?.ok && result.tools && result.tools.length > 0 && (
        <ul className="space-y-0.5 font-mono">
          {result.tools.slice(0, 10).map((tool) => (
            <li key={tool.name} className="truncate">
              <span className="text-primary">{tool.name}</span>
              {tool.description && <span className="ml-2 text-muted-fg">— {tool.description}</span>}
            </li>
          ))}
          {result.tools.length > 10 && (
            <li className="text-muted-fg">… +{result.tools.length - 10}</li>
          )}
        </ul>
      )}
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
              placeholder="--flag o valor"
              varNames={varNames}
              onCreateVar={onCreateVar}
            />
          </div>
          <Button type="button" size="sm" variant="ghost" onClick={() => remove(i)} aria-label="quitar arg">
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
