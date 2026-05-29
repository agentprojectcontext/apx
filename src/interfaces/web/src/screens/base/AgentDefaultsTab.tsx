import useSWR from "swr";
import { Bot, Crown, Sparkles, Wrench } from "lucide-react";
import { Agents } from "../../lib/api";
import { Section } from "../../components/Section";
import { Badge, Empty, Loading } from "../../components/ui";

// Read-only view of the global agent vault (~/.apx/agents/<slug>.md). Importing
// into a project happens from a project's Agents › Importar.
export function AgentDefaultsTab() {
  const vault = useSWR("/agents/vault", () => Agents.vault());
  const items = vault.data || [];

  return (
    <Section
      title="Agent defaults"
      description="Plantillas de agentes del vault (~/.apx/agents). Importalas a un proyecto desde Agents › Importar."
    >
      {vault.isLoading && <Loading />}
      {!vault.isLoading && items.length === 0 && (
        <Empty>Sin plantillas en el vault. Creá una con <code>apx agent vault</code>.</Empty>
      )}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {items.map((a) => (
          <div key={a.slug} className="flex flex-col gap-2 rounded-xl border border-border bg-card p-4">
            <div className="flex items-center gap-2">
              <div className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-slate-600 to-gray-600">
                {a.is_master ? <Crown className="size-4 text-white" /> : <Bot className="size-4 text-white" />}
              </div>
              <span className="truncate text-sm font-semibold">{a.slug}</span>
              {a.model && <Badge tone="info">{a.model}</Badge>}
            </div>
            {a.description && <p className="line-clamp-3 text-xs text-muted-fg">{a.description}</p>}
            <div className="mt-auto flex flex-wrap gap-1">
              {a.role && <Badge>{a.role}</Badge>}
              {a.skills?.map((s) => <span key={s} className="inline-flex items-center gap-0.5 rounded bg-muted px-1 py-0.5 text-[9px] text-muted-fg"><Sparkles size={9} /> {s}</span>)}
              {a.tools?.map((t) => <span key={t} className="inline-flex items-center gap-0.5 rounded bg-muted px-1 py-0.5 text-[9px] text-muted-fg"><Wrench size={9} /> {t}</span>)}
            </div>
          </div>
        ))}
      </div>
    </Section>
  );
}
