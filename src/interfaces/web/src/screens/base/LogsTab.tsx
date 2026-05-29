import { useMemo, useState } from "react";
import useSWR from "swr";
import { ArrowDownLeft, ArrowUpRight, RefreshCw } from "lucide-react";
import { Admin, Messages } from "../../lib/api";
import type { MessageEntry } from "../../types/daemon";
import { Section } from "../../components/Section";
import { Badge, Button, Empty, Input, Loading } from "../../components/ui";
import { UiSelect } from "../../components/UiSelect";

const CLAMP = 320;

function fmtTs(ts: string): string {
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return ts;
  return d.toLocaleString(undefined, {
    month: "short", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
  });
}

function actorLabel(m: MessageEntry): string {
  return m.agent_slug || m.actor_id || m.author || m.actor_kind || "—";
}

function LogRow({ m }: { m: MessageEntry }) {
  const [expanded, setExpanded] = useState(false);
  const long = (m.body?.length || 0) > CLAMP;
  const shown = !long || expanded ? m.body : `${m.body.slice(0, CLAMP)}…`;
  return (
    <li className="flex items-start gap-3 rounded-md border border-border bg-muted/30 px-3 py-2">
      <span className="mt-0.5 shrink-0">
        {m.direction === "in"
          ? <ArrowDownLeft size={14} className="text-blue-400" />
          : <ArrowUpRight size={14} className="text-emerald-400" />}
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-fg">
          <span className="font-mono">{fmtTs(m.ts)}</span>
          <Badge tone="info">{m.channel}</Badge>
          {m.type && <Badge>{m.type}</Badge>}
          <span className="font-medium text-foreground">{actorLabel(m)}</span>
        </div>
        {m.body && (
          <p className="mt-1 whitespace-pre-wrap break-words text-xs">{shown}</p>
        )}
        {long && (
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            className="mt-1 text-[11px] font-medium text-sky-400 hover:underline"
          >
            {expanded ? "ver menos" : "ver más"}
          </button>
        )}
      </div>
    </li>
  );
}

function DaemonErrors() {
  const [open, setOpen] = useState(false);
  const logs = useSWR(open ? "/admin/logs?errors" : null, () => Admin.logs("errors", 200));
  const entries = logs.data?.entries || [];
  return (
    <details className="mb-3 rounded-lg border border-border bg-muted/20" onToggle={(e) => setOpen((e.target as HTMLDetailsElement).open)}>
      <summary className="cursor-pointer px-3 py-2 text-xs font-medium text-muted-fg">
        Errores del daemon (~/.apx/logs/errors.jsonl){entries.length ? ` · ${entries.length}` : ""}
      </summary>
      <div className="border-t border-border p-3">
        {logs.isLoading && <Loading />}
        {open && !logs.isLoading && entries.length === 0 && <p className="text-xs text-muted-fg">Sin errores registrados. 🎉</p>}
        <ul className="space-y-1">
          {entries.map((e, i) => (
            <li key={i} className="rounded-md bg-card px-2 py-1 text-[11px]">
              <div className="flex items-center gap-2 text-muted-fg">
                {typeof e.ts === "string" && <span className="font-mono">{new Date(e.ts).toLocaleString()}</span>}
                {typeof e.level === "string" && <span className="text-destructive">{e.level}</span>}
              </div>
              <p className="whitespace-pre-wrap break-words font-mono">
                {String(e.msg ?? e.message ?? e.error ?? e.raw ?? JSON.stringify(e)).slice(0, 500)}
              </p>
            </li>
          ))}
        </ul>
      </div>
    </details>
  );
}

export function LogsTab({ pid }: { pid?: string }) {
  const isGlobal = !pid || String(pid) === "0";
  const [channel, setChannel] = useState("");
  const [dir, setDir] = useState("");
  const [type, setType] = useState("");
  const [q, setQ] = useState("");
  const ch = channel.trim() || undefined;

  const key = isGlobal
    ? `/messages/global?channel=${ch ?? ""}`
    : `/projects/${pid}/messages?channel=${ch ?? ""}`;
  const list = useSWR<MessageEntry[]>(key, () =>
    isGlobal
      ? Messages.global({ channel: ch, limit: 300 })
      : Messages.project(pid!, { channel: ch, limit: 300 })
  );

  // Newest first, regardless of backend ordering.
  const sorted = useMemo(
    () => [...(list.data || [])].sort((a, b) => (b.ts || "").localeCompare(a.ts || "")),
    [list.data],
  );

  const types = useMemo(
    () => Array.from(new Set(sorted.map((m) => m.type).filter(Boolean))) as string[],
    [sorted],
  );

  const rows = useMemo(() => sorted.filter((m) => {
    if (dir && m.direction !== dir) return false;
    if (type && m.type !== type) return false;
    if (q && !(m.body || "").toLowerCase().includes(q.toLowerCase())) return false;
    return true;
  }), [sorted, dir, type, q]);

  return (
    <Section
      title="Logs"
      description={isGlobal
        ? "Actividad del daemon (canales globales: telegram, direct…). ~/.apx/messages/<channel>/."
        : "Actividad del proyecto. ~/.apx/projects/<id>/messages/."}
      action={
        <div className="flex items-center gap-2">
          <Input
            placeholder="filtrar canal (ej. telegram)"
            value={channel}
            onChange={(e) => setChannel(e.target.value)}
            className="w-44"
          />
          <Button size="sm" variant="secondary" onClick={() => list.mutate()}>
            <RefreshCw size={13} />
          </Button>
        </div>
      }
    >
      {isGlobal && <DaemonErrors />}

      {/* Option filters (client-side over the loaded window) */}
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="w-36">
          <UiSelect
            value={dir}
            onChange={setDir}
            placeholder="dirección"
            options={[
              { value: "", label: "Todas las direcciones" },
              { value: "in", label: "Entrada (in)" },
              { value: "out", label: "Salida (out)" },
            ]}
          />
        </div>
        <div className="w-40">
          <UiSelect
            value={type}
            onChange={setType}
            placeholder="tipo"
            options={[{ value: "", label: "Todos los tipos" }, ...types.map((t) => ({ value: t, label: t }))]}
          />
        </div>
        <Input
          placeholder="buscar en el texto…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          className="w-56"
        />
        <span className="text-[11px] text-muted-fg">{rows.length} de {sorted.length}</span>
      </div>

      {list.isLoading && <Loading />}
      {list.error && <Empty>No pude leer los mensajes: {(list.error as Error).message}</Empty>}
      {!list.isLoading && !list.error && rows.length === 0 && (
        <Empty>Sin actividad{ch ? ` en el canal "${ch}"` : ""}.</Empty>
      )}

      <ul className="space-y-1 text-sm">
        {rows.map((m, i) => <LogRow key={`${m.ts}-${i}`} m={m} />)}
      </ul>
    </Section>
  );
}
