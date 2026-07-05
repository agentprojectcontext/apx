import { Wrench } from "lucide-react";

export interface PluginTool {
  slug: string;
  desc: string;
}

// Lists the agent tools a connected plugin exposes. Read-only: the tools are
// registered in APX's tool registry (category "integrations") and become
// callable for any agent whose role gate allows them, or via discover_tools().
export function PluginToolsSection({ tools, isActive }: { pid: string; tools: PluginTool[]; isActive: boolean }) {
  if (!isActive) return null;

  return (
    <div className="space-y-2.5 rounded-xl border border-border bg-muted/30 p-3">
      <div className="flex items-center justify-between">
        <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
          Tools para agentes
        </p>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {tools.map((t) => (
          <div
            key={t.slug}
            className="flex items-center gap-1.5 rounded-lg border border-border bg-background px-2 py-1"
          >
            <Wrench className="h-2.5 w-2.5 flex-shrink-0 text-muted-foreground" />
            <span className="font-mono text-[10px] text-foreground">{t.slug}</span>
            <span className="text-[10px] text-muted-foreground/60">·</span>
            <span className="text-[10px] text-muted-foreground">{t.desc}</span>
          </div>
        ))}
      </div>
      <p className="text-[10px] text-muted-foreground/70">
        Disponibles para los agentes que las tengan permitidas, o vía <span className="font-mono">discover_tools</span>.
      </p>
    </div>
  );
}
