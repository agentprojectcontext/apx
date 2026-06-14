import { Badge } from "../ui";
import { t } from "../../i18n";
import type { DeckManifest } from "../../lib/api/deck";

function uptimeHuman(s: number): string {
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`;
}

interface DaemonCardProps {
  manifest: DeckManifest;
}

export function DaemonCard({ manifest }: DaemonCardProps) {
  const d = manifest.daemon;
  const s = manifest.safety;

  return (
    <div
      data-testid="deck-daemon-card"
      className="rounded-xl border border-border bg-muted/10 px-4 py-3 text-xs"
    >
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <span className="font-semibold text-foreground">
          {d.name} <span className="font-normal text-muted-fg">v{d.version}</span>
        </span>
        <div className="flex items-center gap-1.5">
          <span className="size-2 rounded-full bg-emerald-500" />
          <span className="text-muted-fg">{t("modules_ui.deck_daemon_active", { uptime: uptimeHuman(d.uptime_s) })}</span>
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        <span className="text-muted-fg">
          {d.host}:{d.port}
        </span>
        <span className="text-muted-fg">·</span>
        <span className="text-muted-fg">
          {t("modules_ui.deck_daemon_started")}{" "}
          {new Date(d.started_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
        </span>
      </div>

      {/* Safety summary */}
      <div className="mt-2.5 flex flex-wrap gap-1.5">
        {s.direct_shell === false && (
          <Badge tone="success">{t("modules_ui.deck_safety_no_shell")}</Badge>
        )}
        {s.arbitrary_commands === false && (
          <Badge tone="success">{t("modules_ui.deck_safety_no_arbitrary")}</Badge>
        )}
        {s.dangerous_actions_require_confirmation && (
          <Badge tone="info">{t("modules_ui.deck_safety_confirm")}</Badge>
        )}
      </div>
    </div>
  );
}
