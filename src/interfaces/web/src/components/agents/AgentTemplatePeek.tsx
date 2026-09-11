import { Bot, Crown, Eye, Sparkles, Wrench } from "lucide-react";
import type { VaultAgent } from "../../lib/api/agents";
import { Popover, PopoverContent, PopoverTrigger } from "../ui/popover";
import { cn } from "../../lib/cn";
import { t } from "../../i18n";

/**
 * The eye next to a vault template: point at it and the template opens up.
 *
 * Importing an agent was a bet on its slug. "gc — General Counsel" says nothing
 * about what that agent is told to do, which model it is pinned to, or whether
 * it can touch the shell — and the only way to find out was to import it and
 * then go read the file it left in .apc/agents. The card answers that where the
 * decision is made, on hover, without leaving the dialog.
 *
 * Hover OR click OR focus: the pointer is the fast path, and the same trigger
 * is a real button so the keyboard and a touch screen get there too.
 */
export function AgentTemplatePeek({
  agent,
  side = "right",
  className,
  label,
}: {
  /** The vault entry. Absent for a pack member with no template on disk — the
   *  eye then renders nothing rather than an empty card. */
  agent?: VaultAgent | null;
  side?: "top" | "right" | "bottom" | "left";
  className?: string;
  /** Shown next to the glyph — the loose-agent cards put "Ver" on the button;
   *  in a team list the eye stands alone in front of the name. */
  label?: string;
}) {
  if (!agent) return null;
  return (
    <Popover>
      <PopoverTrigger
        openOnHover
        delay={120}
        closeDelay={80}
        render={
          <button
            type="button"
            data-testid={`vault-peek-${agent.slug}`}
            aria-label={t("project.agents.preview_label", { slug: agent.slug })}
            onClick={(e) => e.stopPropagation()}
            className={cn(
              "inline-flex shrink-0 items-center gap-1 rounded-md text-muted-fg transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40",
              label ? "border border-border px-1.5 py-1 text-[11px] hover:bg-accent" : "p-0.5",
              className,
            )}
          >
            <Eye className="size-3.5" />
            {label}
          </button>
        }
      />
      <PopoverContent
        side={side}
        align="start"
        className="w-80 max-w-[min(22rem,calc(100vw-2rem))]"
      >
        <TemplateCard agent={agent} />
      </PopoverContent>
    </Popover>
  );
}

function TemplateCard({ agent }: { agent: VaultAgent }) {
  const prompt = (agent.system_preview || "").trim();
  return (
    <div className="space-y-2">
      <div className="flex min-w-0 items-center gap-1.5">
        {agent.is_master
          ? <Crown className="size-3.5 shrink-0 text-emerald-600 dark:text-emerald-400" />
          : <Bot className="size-3.5 shrink-0 text-muted-fg" />}
        <span className="truncate text-sm font-semibold">{agent.name || agent.slug}</span>
        {agent.name && <span className="truncate font-mono text-[10px] text-muted-fg">{agent.slug}</span>}
      </div>

      {agent.role && <div className="text-xs font-medium">{agent.role}</div>}
      {agent.description && <p className="text-xs leading-snug text-muted-fg">{agent.description}</p>}

      <dl className="grid grid-cols-[auto_1fr] gap-x-2 gap-y-0.5 text-[11px]">
        <Row label={t("project.agents.preview_model")}>
          {agent.model || <span className="text-muted-fg">{t("project.agents.preview_model_default")}</span>}
        </Row>
        {agent.type && <Row label={t("project.agents.preview_type")}>{agent.type}</Row>}
        {agent.autonomy && <Row label={t("project.agents.preview_autonomy")}>{agent.autonomy}</Row>}
        {agent.parent && <Row label={t("project.agents.preview_parent")}>{agent.parent}</Row>}
      </dl>

      <div>
        <div className="flex items-baseline justify-between gap-2">
          <span className="text-[10px] font-medium uppercase tracking-wide text-muted-fg">
            {t("project.agents.preview_prompt")}
          </span>
          {!!agent.system_bytes && (
            <span className="text-[10px] text-muted-fg">{formatBytes(agent.system_bytes)}</span>
          )}
        </div>
        {prompt ? (
          <pre className="mt-1 max-h-44 overflow-y-auto whitespace-pre-wrap break-words rounded-md bg-muted/60 p-2 font-mono text-[10px] leading-relaxed text-muted-fg">
            {prompt}{agent.system_more ? "\n…" : ""}
          </pre>
        ) : (
          <p className="mt-1 text-[11px] text-muted-fg">{t("project.agents.preview_no_prompt")}</p>
        )}
      </div>

      {/* Under the prompt, because a template with two dozen tools is a wall of
          chips, and the prompt is what the card is for. */}
      <Chips
        label={t("project.agents.preview_tools")}
        items={agent.tools}
        icon={<Wrench className="size-2.5" />}
        empty={t("project.agents.preview_tools_default")}
      />
      <Chips
        label={t("project.agents.preview_skills")}
        items={agent.skills}
        icon={<Sparkles className="size-2.5" />}
        empty={t("project.agents.preview_skills_none")}
      />
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <>
      <dt className="text-muted-fg">{label}</dt>
      <dd className="min-w-0 truncate">{children}</dd>
    </>
  );
}

function Chips({
  label, items, icon, empty,
}: { label: string; items?: string[] | null; icon: React.ReactNode; empty: string }) {
  return (
    <div className="flex min-w-0 flex-wrap items-baseline gap-1 text-[11px]">
      <span className="text-muted-fg">{label}</span>
      {items?.length
        ? items.map((it) => (
            <span key={it} className="inline-flex items-center gap-0.5 rounded bg-muted px-1 py-0.5 text-[9px] text-muted-fg">
              {icon} {it}
            </span>
          ))
        : <span className="text-[10px] italic text-muted-fg">{empty}</span>}
    </div>
  );
}

function formatBytes(n: number): string {
  return n < 1024 ? `${n} B` : `${(n / 1024).toFixed(1)} KB`;
}
