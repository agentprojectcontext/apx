import { useNavigate } from "react-router-dom";
import { ArrowUp, Terminal } from "lucide-react";
import { useUpdateStatus, UPDATE_CMD } from "../../hooks/useUpdateStatus";
import { t } from "../../i18n";

/**
 * The offer at the foot of the settings nav: there is a newer APX, and here is
 * where you run it.
 *
 * It is the other half of the badge on the gear. A badge that leads to a screen
 * with nothing on it is a blinking light, so the two are driven by the same
 * hook and appear and disappear together.
 *
 * Pressing it OPENS the terminal with the command typed and focused — it does
 * not press Enter for you. That is deliberate, and it is not timidity: `apx
 * update` stops the daemon before it replaces the files, and this terminal is
 * served BY the daemon. A real update therefore kills the connection that is
 * showing it, mid-command. Handing over a prepared command is honest about who
 * is running it; auto-running would be a button that appears to fail every time
 * it actually works. The note under the button says so in one line.
 */
export function UpdateOffer() {
  const navigate = useNavigate();
  const { newer, current, latest } = useUpdateStatus();

  if (!newer) return null;

  return (
    <div
      data-testid="update-offer"
      className="rounded-xl border border-primary/30 bg-primary/8 p-2.5"
    >
      <p className="flex items-center gap-1.5 text-[11px] font-medium text-foreground">
        <ArrowUp size={12} className="shrink-0 text-primary" />
        {t("update.title")}
      </p>
      <p className="mt-0.5 font-mono text-[10px] text-muted-fg">
        {current} → {latest}
      </p>
      <button
        type="button"
        data-testid="update-offer-run"
        onClick={() => navigate(`/code?cmd=${encodeURIComponent(UPDATE_CMD)}`)}
        className="mt-2 flex w-full cursor-pointer items-center justify-center gap-1.5 rounded-lg bg-primary px-2 py-1.5 text-[11px] font-medium text-primary-fg transition-colors hover:bg-primary/90"
      >
        <Terminal size={12} />
        {t("update.open_terminal")}
      </button>
      <p className="mt-1.5 text-[10px] leading-snug text-muted-fg">{t("update.daemon_note")}</p>
    </div>
  );
}
