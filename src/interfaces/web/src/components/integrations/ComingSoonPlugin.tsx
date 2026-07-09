import { useState, type ComponentType } from "react";
import { Github, Mic, Puzzle } from "lucide-react";
import type { CatalogEntry } from "../../lib/api";
import { t } from "../../i18n";
import { PluginCard } from "./PluginCard";
import { WhatsAppLogo } from "./BrandLogos";

const ICONS: Record<string, { icon: ComponentType<{ className?: string }>; className: string; wrap: string }> = {
  github: { icon: Github, className: "text-slate-200", wrap: "border-slate-500/30 from-slate-500/20 to-slate-700/20" },
  whatsapp: { icon: WhatsAppLogo, className: "text-[#25D366]", wrap: "border-[#25D366]/30 from-[#25D366]/20 to-[#128C7E]/20" },
  "local-transcription": { icon: Mic, className: "text-orange-400", wrap: "border-orange-500/30 from-orange-500/20 to-amber-500/20" },
};

// Placeholder card for catalog plugins that are declared but not yet wired to a
// live service module (github/whatsapp/transcription). Keeps the Integrations
// page complete and makes it obvious what's on the roster.
export function ComingSoonPlugin({ entry }: { entry: CatalogEntry }) {
  const [expanded, setExpanded] = useState(false);
  const cfg = ICONS[entry.slug] || { icon: Puzzle, className: "text-muted-foreground", wrap: "border-border from-muted to-muted" };
  const Icon = cfg.icon;

  return (
    <PluginCard
      icon={
        <div className={`flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-2xl border bg-gradient-to-br ${cfg.wrap}`}>
          <Icon className={`h-6 w-6 ${cfg.className}`} />
        </div>
      }
      title={entry.name}
      description={entry.description}
      badges={
        <span className="rounded-full border border-border bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
          {t("integrations.coming_soon")}
        </span>
      }
      expanded={expanded}
      onToggle={() => setExpanded((v) => !v)}
    >
      <div className="p-4 text-xs text-muted-foreground">{t("integrations.coming_soon_body")}</div>
    </PluginCard>
  );
}
