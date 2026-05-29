import { useState } from "react";
import useSWR from "swr";
import { RefreshCw } from "lucide-react";
import { Sessions } from "../../lib/api";
import { Section } from "../../components/Section";
import { Badge, Button, Empty, Loading } from "../../components/ui";
import { UiSelect } from "../../components/UiSelect";

const ENGINE_TONE: Record<string, "success" | "info" | "warning" | "muted"> = {
  apx: "success", claude: "info", codex: "warning",
};

export function SessionsTab() {
  const [engine, setEngine] = useState("");
  const list = useSWR(`/sessions?engine=${engine}`, () => Sessions.global(engine || undefined));
  const rows = list.data?.sessions || [];

  return (
    <Section
      title="Sessions"
      description="Sesiones de todos los engines (apx · claude · codex), más nuevas primero."
      action={
        <div className="flex items-center gap-2">
          <div className="w-40">
            <UiSelect
              value={engine}
              onChange={setEngine}
              options={[
                { value: "", label: "Todos los engines" },
                { value: "apx", label: "apx" },
                { value: "claude", label: "claude" },
                { value: "codex", label: "codex" },
              ]}
            />
          </div>
          <Button size="sm" variant="secondary" onClick={() => list.mutate()}><RefreshCw size={13} /></Button>
        </div>
      }
    >
      {list.isLoading && <Loading />}
      {list.error && <Empty>No pude leer las sesiones: {(list.error as Error).message}</Empty>}
      {!list.isLoading && !list.error && rows.length === 0 && <Empty>Sin sesiones.</Empty>}
      <ul className="space-y-1 text-sm">
        {rows.map((s, i) => (
          <li key={`${s.engine}-${s.id}-${i}`} className="flex items-center gap-3 rounded-md border border-border bg-muted/30 px-3 py-2">
            <Badge tone={ENGINE_TONE[s.engine] || "muted"}>{s.engine}</Badge>
            <div className="min-w-0 flex-1">
              <div className="truncate">{s.title || s.id}</div>
              <div className="truncate font-mono text-[10px] text-muted-fg">{s.cwd}</div>
            </div>
            {s.mtime > 0 && <span className="shrink-0 text-[11px] text-muted-fg">{new Date(s.mtime).toLocaleString()}</span>}
          </li>
        ))}
      </ul>
    </Section>
  );
}
