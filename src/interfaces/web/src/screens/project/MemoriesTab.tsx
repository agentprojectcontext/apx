import { useEffect, useState } from "react";
import useSWR from "swr";
import { Bot, Brain, ChevronDown, ChevronRight, Crown, Save } from "lucide-react";
import { Agents, Projects } from "../../lib/api";
import type { AgentEntry } from "../../types/daemon";
import { Section } from "../../components/Section";
import { Button, Empty, Loading, Textarea } from "../../components/ui";
import { useToast } from "../../components/Toast";

// Editable markdown memory block with dirty-tracking + save.
function MemoryEditor({
  load,
  save,
  rows = 10,
  placeholder = "(memoria vacía)",
}: {
  load: () => Promise<string>;
  save: (body: string) => Promise<void>;
  rows?: number;
  placeholder?: string;
}) {
  const toast = useToast();
  const [original, setOriginal] = useState<string | null>(null);
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let live = true;
    load().then((b) => { if (live) { setOriginal(b); setValue(b); } }).catch(() => { if (live) { setOriginal(""); setValue(""); } });
    return () => { live = false; };
  }, [load]);

  if (original === null) return <Loading />;
  const dirty = value !== original;

  const onSave = async () => {
    setBusy(true);
    try {
      await save(value);
      setOriginal(value);
      toast.success("Memoria guardada.");
    } catch (e) { toast.error((e as Error).message); }
    finally { setBusy(false); }
  };

  return (
    <div className="space-y-2">
      <Textarea
        rows={rows}
        className="font-mono text-xs"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder={placeholder}
      />
      <div className="flex items-center justify-between">
        <span className="text-[11px] text-muted-fg">{value.length} chars · Markdown</span>
        <Button size="sm" variant="primary" loading={busy} disabled={!dirty} onClick={onSave}>
          <Save size={12} /> Guardar
        </Button>
      </div>
    </div>
  );
}

function AgentMemoryRow({ pid, agent }: { pid: string; agent: AgentEntry }) {
  const [open, setOpen] = useState(false);
  const Icon = agent.is_master ? Crown : Bot;
  return (
    <li className="rounded-xl border border-border bg-muted/30">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-3 px-3 py-2 text-left"
      >
        {open ? <ChevronDown size={14} className="text-muted-fg" /> : <ChevronRight size={14} className="text-muted-fg" />}
        <Icon size={14} className={agent.is_master ? "text-violet-400" : "text-muted-fg"} />
        <span className="text-sm font-medium">{agent.slug}</span>
        {agent.role && <span className="text-xs text-muted-fg">· {agent.role}</span>}
      </button>
      {open && (
        <div className="border-t border-border p-3">
          <MemoryEditor
            rows={8}
            load={() => Agents.memory.get(pid, agent.slug).then((r) => r.body)}
            save={(body) => Agents.memory.put(pid, agent.slug, body).then(() => {})}
          />
        </div>
      )}
    </li>
  );
}

export function MemoriesTab({ pid }: { pid: string }) {
  const agents = useSWR(`/projects/${pid}/agents`, () => Agents.list(pid));

  return (
    <div className="space-y-6">
      <Section
        title="Memoria del proyecto"
        description="Hechos durables a nivel proyecto. .apc/memory.md — la leen los agentes y el super-agente."
      >
        <div className="flex items-start gap-3">
          <div className="mt-1 flex size-9 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-sky-600 to-indigo-600">
            <Brain className="size-4 text-white" />
          </div>
          <div className="min-w-0 flex-1">
            <MemoryEditor
              rows={12}
              load={() => Projects.memory.get(pid).then((r) => r.body)}
              save={(body) => Projects.memory.put(pid, body).then(() => {})}
              placeholder="# Memoria del proyecto&#10;&#10;Hechos estables que cualquier agente debería saber…"
            />
          </div>
        </div>
      </Section>

      <Section
        title="Memorias de agentes"
        description="Memoria individual por agente. .apc/agents/<slug>/memory.md"
      >
        {agents.isLoading && <Loading />}
        {!agents.isLoading && (agents.data?.length ?? 0) === 0 && (
          <Empty>Sin agentes en este proyecto.</Empty>
        )}
        <ul className="space-y-2">
          {(agents.data || []).map((a) => (
            <AgentMemoryRow key={a.slug} pid={pid} agent={a} />
          ))}
        </ul>
      </Section>
    </div>
  );
}
