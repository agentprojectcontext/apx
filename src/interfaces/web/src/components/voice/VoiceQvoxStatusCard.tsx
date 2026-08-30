// "Local voice on this Mac" — the standing report on the self-hosted engine.
//
// Lives next to the test/STT cards rather than in the provider list because it
// answers a different question. The list says what is configured; this says
// whether the thing is actually up.
//
// Its badge comes from a live probe, not from the provider list's `available`
// flag: that flag is a config probe by design (a custom endpoint counts as
// available for having a base_url), so it reads green with the server stopped.
// A status card that cannot go red is worse than no status card.
import useSWR from "swr";
import { Badge } from "../ui";
import { t } from "../../i18n";
import { Voice } from "../../lib/api/voice";
import { QVOX_REPO } from "../../lib/qvox";

export function VoiceQvoxStatusCard({ force }: { force?: "running" | "stopped" }) {
  // Polled, because the interesting transition (the server dying) produces no
  // event anywhere. 15s is often enough to notice and rare enough to ignore.
  const { data } = useSWR(
    force ? null : "/api/tts/reachable",
    () => Voice.reachable(),
    { refreshInterval: 15_000 }
  );
  const running = force ? force === "running" : !!data?.reachable;
  // Until the first probe answers, say nothing rather than flash "Stopped" at
  // a server that is perfectly fine.
  const known = !!force || data !== undefined;

  return (
    <div className="rounded-xl border border-border p-5" data-testid="qvox-status">
      <div className="flex items-center gap-2">
        <h3 className="text-sm font-semibold text-foreground">{t("voice_ui.qvox_title")}</h3>
        {known && (
          <Badge tone={running ? "success" : "warning"}>
            {running ? t("voice_ui.qvox_running") : t("voice_ui.qvox_stopped")}
          </Badge>
        )}
      </div>
      <p className="mt-1.5 text-sm text-muted-fg">
        {known && !running ? t("voice_ui.qvox_stopped_hint") : t("voice_ui.qvox_body")}
      </p>
      <a
        href={QVOX_REPO}
        target="_blank"
        rel="noreferrer"
        className="mt-3 inline-block text-xs text-muted-fg underline underline-offset-2 hover:text-foreground"
      >
        {t("voice_ui.qvox_repo")}
      </a>
    </div>
  );
}
