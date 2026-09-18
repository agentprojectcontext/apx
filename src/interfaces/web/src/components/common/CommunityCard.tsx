import { useState } from "react";
import { X } from "lucide-react";
import { LINKS, STORAGE } from "../../constants";
import { cn } from "../../lib/cn";
import { t } from "../../i18n";

/**
 * The invitation to the Discord — a card in the corner of the panel, and a strip
 * at the top of the phone's list.
 *
 * APX arrives from a repo, not from a store, so there is no listing page where
 * someone who just got the daemon running would discover that other people are
 * running it too. The panel says it once and then never again: dismissal is
 * remembered in localStorage, which is per DEVICE, so closing it on the desktop
 * leaves the phone free to make the same offer on the screen it lands on.
 *
 * It used to sit at the FOOT of the phone's list, which is what "last" meant
 * when the list was short. Measured on a real inbox it landed at 8275px inside
 * an 8304px scroller — twenty chats below the fold, which is not a quiet
 * invitation but an invisible one. It now joins the two offers that already
 * live at the top for the same reason: a phone lands there and scrolls down,
 * never up.
 *
 * Deliberately not a modal and not a toast. An invitation that interrupts is an
 * advert, and this one has to survive being ignored.
 */
export function CommunityCard({ variant = "floating" }: { variant?: "floating" | "inline" }) {
  const [hidden, setHidden] = useState(() => {
    try {
      return localStorage.getItem(STORAGE.discordDismissed) === "1";
    } catch {
      return false;
    }
  });

  if (hidden) return null;

  const dismiss = () => {
    setHidden(true);
    try {
      localStorage.setItem(STORAGE.discordDismissed, "1");
    } catch {
      /* private mode: gone for this session, which is enough */
    }
  };

  // On the phone it is one line among the other offers, not a card: three
  // stacked cards above a list is a screen you have to get past.
  if (variant === "inline") {
    return (
      <div
        data-testid="community-card"
        className="flex shrink-0 items-center gap-3 border-b border-border bg-[#5865F2]/8 px-4 py-3 text-sm"
      >
        <DiscordMark className="size-4 shrink-0 text-[#5865F2]" />
        <span className="min-w-0 flex-1 [overflow-wrap:anywhere]">{t("community.title")}</span>
        <a
          href={LINKS.discord}
          target="_blank"
          rel="noopener noreferrer"
          onClick={dismiss}
          className="shrink-0 rounded-full bg-[#5865F2] px-3 py-1.5 text-xs font-medium text-white"
        >
          {t("community.cta")}
        </a>
        <button
          type="button"
          onClick={dismiss}
          aria-label={t("common.close")}
          className="shrink-0 rounded p-1 text-muted-fg hover:text-foreground"
        >
          <X size={14} />
        </button>
      </div>
    );
  }

  return (
    <div
      data-testid="community-card"
      className={cn("flex items-start gap-3 text-sm", "rounded-2xl border border-border bg-card/95 p-3 shadow-lg backdrop-blur")}
    >
      <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-[#5865F2]/12">
        <DiscordMark className="size-5 text-[#5865F2]" />
      </span>

      <div className="min-w-0 flex-1">
        <p className="font-medium">{t("community.title")}</p>
        <p className="mt-0.5 text-[13px] leading-snug text-muted-fg">{t("community.desc")}</p>
        <a
          href={LINKS.discord}
          target="_blank"
          rel="noopener noreferrer"
          onClick={dismiss}
          className="mt-2.5 inline-flex items-center gap-2 rounded-lg bg-[#5865F2] px-3 py-1.5 text-[13px] font-medium text-white transition-colors hover:bg-[#4752C4]"
        >
          <DiscordMark className="size-4" />
          {t("community.cta")}
        </a>
      </div>

      <button
        type="button"
        onClick={dismiss}
        aria-label={t("common.close")}
        className="-mr-1 shrink-0 rounded p-1 text-muted-fg hover:text-foreground"
      >
        <X size={14} />
      </button>
    </div>
  );
}

/**
 * Discord's own mark. Inline rather than an icon dependency: lucide dropped
 * brand glyphs, and a logo that links to the service it belongs to is the one
 * place a brand path is the right answer.
 */
function DiscordMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" className={className}>
      <path d="M20.317 4.3698a19.7913 19.7913 0 0 0-4.8851-1.5152.0741.0741 0 0 0-.0785.0371c-.211.3753-.4447.8648-.6083 1.2495-1.8447-.2762-3.68-.2762-5.4868 0-.1636-.3933-.4058-.8742-.6177-1.2495a.077.077 0 0 0-.0785-.037 19.7363 19.7363 0 0 0-4.8852 1.515.0699.0699 0 0 0-.0321.0277C.5334 9.0458-.319 13.5799.0992 18.0578a.0824.0824 0 0 0 .0312.0561c2.0528 1.5076 4.0413 2.4228 5.9929 3.0294a.0777.0777 0 0 0 .0842-.0276c.4616-.6304.8731-1.2952 1.226-1.9942a.076.076 0 0 0-.0416-.1057c-.6528-.2476-1.2743-.5495-1.8722-.8923a.077.077 0 0 1-.0076-.1277c.1258-.0943.2517-.1923.3718-.2914a.0743.0743 0 0 1 .0776-.0105c3.9278 1.7933 8.18 1.7933 12.0614 0a.0739.0739 0 0 1 .0785.0095c.1202.099.246.1981.3728.2924a.077.077 0 0 1-.0066.1276 12.2986 12.2986 0 0 1-1.873.8914.0766.0766 0 0 0-.0407.1067c.3604.698.7719 1.3628 1.225 1.9932a.076.076 0 0 0 .0842.0286c1.961-.6067 3.9495-1.5219 6.0023-3.0294a.077.077 0 0 0 .0313-.0552c.5004-5.177-.8382-9.6739-3.5485-13.6604a.061.061 0 0 0-.0312-.0286zM8.02 15.3312c-1.1825 0-2.1569-1.0857-2.1569-2.419 0-1.3332.9555-2.4189 2.157-2.4189 1.2108 0 2.1757 1.0952 2.1568 2.419 0 1.3332-.9555 2.4189-2.1569 2.4189zm7.9748 0c-1.1825 0-2.1569-1.0857-2.1569-2.419 0-1.3332.9554-2.4189 2.1569-2.4189 1.2108 0 2.1757 1.0952 2.1568 2.419 0 1.3332-.946 2.4189-2.1568 2.4189Z" />
    </svg>
  );
}
