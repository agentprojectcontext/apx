import { useState } from "react";
import useSWR from "swr";
import { Check, Plus, RotateCcw, Trash2 } from "lucide-react";
import { Tasks } from "../../lib/api";
import { Section } from "../../components/Section";
import { Badge, Button, Empty, Field, Input, Loading } from "../../components/ui";
import { useToast } from "../../components/Toast";

export function TasksTab({ pid }: { pid: string }) {
  const [state, setState] = useState<"open" | "done" | "dropped">("open");
  const toast = useToast();
  const list = useSWR(`/projects/${pid}/tasks?state=${state}`, () => Tasks.list(pid, state));
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);

  const add = async () => {
    if (!draft.trim()) return;
    setBusy(true);
    try {
      await Tasks.add(pid, { title: draft.trim() });
      setDraft("");
      toast.success("Task creada.");
      list.mutate();
    } catch (e: any) {
      toast.error(e?.message || "no pude crear la task");
    } finally {
      setBusy(false);
    }
  };
  const mark = async (fn: () => Promise<unknown>, label: string) => {
    try { await fn(); toast.success(label); list.mutate(); }
    catch (e: any) { toast.error(e?.message || "falló"); }
  };

  return (
    <Section
      title="Tasks (TODOs)"
      description="Append-only JSONL en ~/.apx/projects/<id>/tasks/."
      action={
        <div className="flex gap-1">
          {(["open", "done", "dropped"] as const).map((s) => (
            <Button key={s} size="sm" variant={state === s ? "primary" : "ghost"} onClick={() => setState(s)}>
              {s}
            </Button>
          ))}
        </div>
      }
    >
      <div className="mb-4 flex items-end gap-2">
        <Field label="Nueva task">
          <Input
            placeholder="ej. revisar bug del scroll"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") add(); }}
          />
        </Field>
        <Button variant="primary" onClick={add} loading={busy}>
          <Plus size={14} /> agregar
        </Button>
      </div>

      {list.isLoading && <Loading />}
      {!list.isLoading && (list.data?.length ?? 0) === 0 && (
        <Empty>No hay tasks {state === "open" ? "abiertas" : state}. <code>apx task add "…"</code></Empty>
      )}

      <ul className="space-y-2 text-sm">
        {(list.data || []).map((t) => (
          <li key={t.id} className="flex items-start gap-3 rounded-md border border-border bg-muted/30 px-3 py-2">
            <span className="mt-0.5 font-mono text-[10px] text-muted-fg">{t.id}</span>
            <div className="flex-1">
              <div className="font-medium">{t.title}</div>
              <div className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-muted-fg">
                {t.tags?.map((tag) => <Badge key={tag}>#{tag}</Badge>)}
                {t.agent && <Badge tone="info">@{t.agent}</Badge>}
                {t.source && <span>via {t.source}</span>}
                {t.due && <span>vence {t.due}</span>}
              </div>
            </div>
            <div className="flex gap-1">
              {state === "open" && (
                <>
                  <Button size="sm" variant="secondary" onClick={() => mark(() => Tasks.done(pid, t.id), "✓ done")}>
                    <Check size={13} />
                  </Button>
                  <Button size="sm" variant="destructive" onClick={() => mark(() => Tasks.drop(pid, t.id), "✗ drop")}>
                    <Trash2 size={13} />
                  </Button>
                </>
              )}
              {state !== "open" && (
                <Button size="sm" variant="ghost" onClick={() => mark(() => Tasks.reopen(pid, t.id), "↻ reopen")}>
                  <RotateCcw size={13} />
                </Button>
              )}
            </div>
          </li>
        ))}
      </ul>
    </Section>
  );
}
