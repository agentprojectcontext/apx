import { useState } from "react";
import useSWR from "swr";
import { Puzzle, Wrench } from "lucide-react";
import { Integrations, type CatalogEntry, type IntegrationScope } from "../../lib/api";
import { cn } from "../../lib/cn";
import { Section } from "../../components/Section";
import { Empty, Loading } from "../../components/ui";
import { PluginConnect } from "../../components/integrations/PluginConnect";
import { ComingSoonPlugin } from "../../components/integrations/ComingSoonPlugin";
import { t } from "../../i18n";

type SubTab = "plugins" | "tools";

const SUBTABS: { value: SubTab; labelKey: "integrations.tab_plugins" | "integrations.tab_tools"; icon: typeof Puzzle }[] = [
  { value: "plugins", labelKey: "integrations.tab_plugins", icon: Puzzle },
  { value: "tools", labelKey: "integrations.tab_tools", icon: Wrench },
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
      <p className="text-xs text-muted-foreground">{t("integrations.plugins_hint")}</p>
      {isLoading && <Loading />}
      {(catalog || []).map((entry) => (
        <PluginRow key={entry.slug} pid={pid} scope={scope} entry={entry} />
      ))}
      <div className="rounded-xl border border-dashed border-border p-6 text-center">
        <p className="text-sm text-muted-foreground">{t("integrations.more_soon")}</p>
      </div>
    </div>
  );
}

function ToolsSection({ pid }: { pid: string }) {
  const { data: catalog } = useSWR(`integrations-catalog-${pid}`, () => Integrations.catalog(pid));
  const rows = (catalog || [])
    .filter((c) => !c.coming_soon && (c.tools?.length ?? 0) > 0)
    .flatMap((c) => (c.tools || []).map((tool) => ({ ...tool, plugin: c.name, active: c.status.is_enabled })));

  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">{t("integrations.tools_hint")}</p>
      {rows.length === 0 ? (
        <Empty>{t("integrations.tools_empty")}</Empty>
      ) : (
        <ul className="space-y-2">
          {rows.map((tool) => (
            <li key={tool.slug} className={cn("rounded-md border border-border bg-muted/30 px-3 py-2", !tool.active && "opacity-55")}>
              <div className="flex items-center gap-2">
                <Wrench className="h-3.5 w-3.5 text-muted-foreground" />
                <span className="font-mono text-xs text-foreground">{tool.slug}</span>
                <span className="ml-auto text-[10px] text-muted-foreground">{tool.plugin}</span>
                <span
                  className={cn(
                    "rounded border px-1.5 py-0.5 text-[10px]",
                    tool.active
                      ? "border-emerald-700/40 bg-emerald-900/20 text-emerald-400"
                      : "border-border bg-muted text-muted-foreground",
                  )}
                >
                  {tool.active ? t("integrations.tool_active") : t("integrations.tool_inactive")}
                </span>
              </div>
              <p className="mt-0.5 pl-5 text-[10px] text-muted-foreground">{tool.desc}</p>
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
    <Section title={t("integrations.title")} description={t("integrations.description")}>
      {/* Scope selector — a real project can use its own integrations or the
          global (default-project) ones. */}
      {!isBase && (
        <div className="mb-4 flex items-center gap-2">
          <span className="text-xs text-muted-foreground">{t("integrations.scope_label")}</span>
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
              {s === "project" ? t("integrations.scope_project") : t("integrations.scope_global")}
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
              <Icon className="h-3.5 w-3.5" /> {t(s.labelKey)}
            </button>
          );
        })}
      </div>

      {tab === "plugins" && <PluginsSection pid={pid} scope={scope} />}
      {tab === "tools" && <ToolsSection pid={pid} />}
    </Section>
  );
}
