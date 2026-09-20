import { useNavigate } from "react-router-dom";
import { ArrowUp, Terminal } from "lucide-react";
import { useUpdateStatus, UPDATE_CMD } from "../../hooks/useUpdateStatus";
import { Tip } from "../ui/tip";
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
 * it actually works.
 *
 * Everything here is written for a 176px-wide rail. The first draft said the
 * whole truth in the card and wrapped the title, the button label AND four
 * lines of note into a squashed block. What is left visible is the part you
 * decide with; the reassurance about the daemon restarting — which matters
 * once, while it happens — moved into the button's tooltip.
 */
export function UpdateOffer() {
  const navigate = useNavigate();
  const { newer, current, latest } = useUpdateStatus();

  if (!newer) return null;

  return (
    <div
      data-testid="update-offer"
      className="space-y-2.5 rounded-xl border border-primary/30 bg-primary/8 p-3"
    >
      <div className="space-y-1">
        <p className="flex items-center gap-1.5 text-xs font-semibold text-foreground">
          <ArrowUp size={13} className="shrink-0 text-primary" />
          {t("update.title")}
        </p>
        {/* The two versions on their own line, in mono so the digits line up
            and the arrow reads as "this becomes that". */}
        <p className="pl-[18px] font-mono text-[11px] leading-relaxed text-muted-fg">
          {current} <span className="text-primary">→</span> {latest}
        </p>
      </div>

      <Tip content={t("update.daemon_tip")} side="right">
        <button
          type="button"
          data-testid="update-offer-run"
          onClick={() => navigate(`/code?cmd=${encodeURIComponent(UPDATE_CMD)}`)}
          className="flex w-full cursor-pointer items-center justify-center gap-1.5 whitespace-nowrap rounded-lg bg-primary px-2 py-2 text-xs font-medium text-primary-fg transition-colors hover:bg-primary/90"
        >
          <Terminal size={13} />
          {t("update.open_terminal")}
        </button>
      </Tip>

      <p className="text-[10px] leading-relaxed text-muted-fg">{t("update.daemon_note")}</p>
    </div>
  );
}
