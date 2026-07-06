import { useState } from "react";
import useSWR from "swr";
import { Puzzle, Wrench } from "lucide-react";
import { Integrations, type CatalogEntry, type IntegrationScope } from "../../lib/api";
import { cn } from "../../lib/cn";
import { Section } from "../../components/Section";
import { Empty, Loading } from "../../components/ui";
import { PluginConnect } from "../../components/integrations/PluginConnect";
import { ComingSoonPlugin } from "../../components/integrations/ComingSoonPlugin";

type SubTab = "plugins" | "tools";

const SUBTABS: { value: SubTab; label: string; icon: typeof Puzzle }[] = [
  { value: "plugins", label: "Plugins", icon: Puzzle },
  { value: "tools", label: "Tools", icon: Wrench },
];

// Renders a connectable plugin (via the generic PluginConnect, driven by its
// `ui` descriptor) or a coming-soon placeholder. MCP servers are NOT shown here
// — they have their own top-level "MCPs" nav item.
function PluginRow({ pid, scope, entry }: { pid: string; scope: IntegrationScope; entry: CatalogEntry }) {
  if (entry.coming_soon || !entry.ui) return <ComingSoonPlugin entry={entry} />;
  return <PluginConnect pid={pid} scope={scope} entry={entry} />;
}

function PluginsSection({ pid, scope }: { pid: string; scope: IntegrationScope }) {
  const { data: catalog, isLoading } = useSWR(`integrations-catalog-${pid}`, () => Integrations.catalog(pid));

  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">
        Plugins de canal y servicio instalables por proyecto. Se guardan en el ámbito
        seleccionado arriba.
      </p>
      {isLoading && <Loading />}
      {(catalog || []).map((entry) => (
        <PluginRow key={entry.slug} pid={pid} scope={scope} entry={entry} />
      ))}
      <div className="rounded-xl border border-dashed border-border p-6 text-center">
        <p className="text-sm text-muted-foreground">Más plugins próximamente…</p>
      </div>
    </div>
  );
}

function ToolsSection({ pid }: { pid: string }) {
  const { data: catalog } = useSWR(`integrations-catalog-${pid}`, () => Integrations.catalog(pid));
  const rows = (catalog || [])
    .filter((c) => !c.coming_soon && (c.tools?.length ?? 0) > 0)
    .flatMap((c) => (c.tools || []).map((t) => ({ ...t, plugin: c.name, active: c.status.is_enabled })));

  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">
        Tools que los plugins conectados exponen a los agentes de este proyecto.
      </p>
      {rows.length === 0 ? (
        <Empty>No hay tools de integraciones. Conectá un plugin para habilitarlas.</Empty>
      ) : (
        <ul className="space-y-2">
          {rows.map((t) => (
            <li key={t.slug} className={cn("rounded-md border border-border bg-muted/30 px-3 py-2", !t.active && "opacity-55")}>
              <div className="flex items-center gap-2">
                <Wrench className="h-3.5 w-3.5 text-muted-foreground" />
                <span className="font-mono text-xs text-foreground">{t.slug}</span>
                <span className="ml-auto text-[10px] text-muted-foreground">{t.plugin}</span>
                <span
                  className={cn(
                    "rounded border px-1.5 py-0.5 text-[10px]",
                    t.active
                      ? "border-emerald-700/40 bg-emerald-900/20 text-emerald-400"
                      : "border-border bg-muted text-muted-foreground",
                  )}
                >
                  {t.active ? "activo" : "inactivo"}
                </span>
              </div>
              <p className="mt-0.5 pl-5 text-[10px] text-muted-foreground">{t.desc}</p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function IntegrationsTab({ pid }: { pid: string }) {
  const isBase = String(pid) === "0";
  const [tab, setTab] = useState<SubTab>("plugins");
  // On the base project, project scope IS the global (default) store.
  const [scope, setScope] = useState<IntegrationScope>(isBase ? "global" : "project");

  return (
    <Section
      title="Integrations"
      description="Plugins y tools disponibles para este proyecto"
    >
      {/* Scope selector — a real project can use its own integrations or the
          global (default-project) ones. */}
      {!isBase && (
        <div className="mb-4 flex items-center gap-2">
          <span className="text-xs text-muted-foreground">Ámbito:</span>
          {(["project", "global"] as const).map((s) => (
            <button
              key={s}
              onClick={() => setScope(s)}
              className={cn(
                "rounded-md border px-2.5 py-1 text-xs transition-colors",
                scope === s
                  ? "border-primary/50 bg-primary/10 text-foreground"
                  : "border-border bg-muted/30 text-muted-foreground hover:bg-muted/50",
              )}
            >
              {s === "project" ? "Este proyecto" : "Global (default)"}
            </button>
          ))}
        </div>
      )}

      {/* Sub-tabs */}
      <div className="mb-4 inline-flex rounded-lg border border-border bg-muted/30 p-0.5">
        {SUBTABS.map((s) => {
          const Icon = s.icon;
          return (
            <button
              key={s.value}
              onClick={() => setTab(s.value)}
              className={cn(
                "flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs transition-colors",
                tab === s.value ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
              )}
            >
              <Icon className="h-3.5 w-3.5" /> {s.label}
            </button>
          );
        })}
      </div>

      {tab === "plugins" && <PluginsSection pid={pid} scope={scope} />}
      {tab === "tools" && <ToolsSection pid={pid} />}
    </Section>
  );
}
