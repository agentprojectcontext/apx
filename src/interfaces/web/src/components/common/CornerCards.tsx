import { useState } from "react";
import { Star, X } from "lucide-react";
import { CommunityCard } from "./CommunityCard";
import { UpdateBanner } from "./UpdateBanner";
import { NotifyNudge } from "../settings/PanelPrefs";
import { LINKS, STORAGE } from "../../constants";
import { t } from "../../i18n";

/**
 * One corner, a deck of cards.
 *
 * Four things want to be said to someone opening the panel — turn notifications
 * on, there is a Discord, there is a newer APX, the repo takes stars — and all
 * four at once is a wall you close four times before you can read the screen
 * behind it. They queue instead: the first one that applies is the only one
 * visible, and closing it brings the next.
 *
 * The queue is the DOM order, and the stacking is CSS. Each card already returns
 * null when it is dismissed or does not apply, so whatever is left as
 * `:first-child` is by definition the first that still has something to say —
 * no card has to know about the others, and adding one is adding a line here.
 *
 * The two behind it peek out, shrunk and faded, so closing one does not feel
 * like something appearing from nowhere: you could already see it was there.
 * They are `pointer-events-none`, so the only card you can click is the one you
 * can actually read.
 *
 * Order is deliberate. The permission ask goes first because it is the only one
 * that silently stops working if ignored: no notifications ever arrive. The
 * rest are invitations and can wait for each other.
 */
export function CornerCards() {
  return (
    <div
      className={[
        // `pointer-events-none` on the box, `auto` on the card: the box is a
        // 24rem rectangle that draws nothing, and it has no business taking a
        // click that misses the card inside it.
        //
        // This is hygiene, NOT the fix for the e2e failures these cards caused.
        // Those were the card itself, visibly covering `task-comment-send` at
        // 1280x720 once Playwright scrolled it into view — measured: the point
        // it clicks returned `community-card`. A card that is meant to be seen
        // will cover things, so the harness dismisses them (see e2e/fixtures).
        "pointer-events-none fixed bottom-4 right-4 z-50 w-[min(24rem,calc(100vw-2rem))]",
        // The one in front is IN FLOW, so the container takes its height and
        // the corner keeps its size. The rest are absolute against the same
        // bottom edge, which is what makes them a deck instead of a list.
        "[&>*]:origin-top [&>*]:transition-all [&>*]:duration-200",
        "[&>*:first-child]:pointer-events-auto [&>*:first-child]:relative [&>*:first-child]:z-30",
        // Anchored to the TOP of the front card, not the bottom. Anchored at
        // the bottom the peek depended on the cards' relative heights, and the
        // tallest one happened to be in front — so the deck was there, measured
        // correctly, and completely invisible.
        "[&>*:not(:first-child)]:pointer-events-none [&>*:not(:first-child)]:absolute [&>*:not(:first-child)]:inset-x-0 [&>*:not(:first-child)]:top-0",
        "[&>*:nth-child(2)]:z-20 [&>*:nth-child(2)]:-translate-y-2 [&>*:nth-child(2)]:scale-95 [&>*:nth-child(2)]:opacity-70",
        "[&>*:nth-child(3)]:z-10 [&>*:nth-child(3)]:-translate-y-4 [&>*:nth-child(3)]:scale-90 [&>*:nth-child(3)]:opacity-45",
        // Four deep is a pile, not a hint that there is more behind.
        "[&>*:nth-child(n+4)]:hidden",
      ].join(" ")}
    >
      <NotifyNudge floating className="static w-full max-w-none" />
      <CommunityCard />
      <UpdateBanner />
      <StarCard />
    </div>
  );
}

/**
 * "This repo takes stars."
 *
 * Last in the queue on purpose: it asks for something instead of offering it,
 * and it should be the last thing anyone is bothered with. Once closed it never
 * returns — an ask that comes back is a beg.
 */
function StarCard() {
  const [hidden, setHidden] = useState(() => {
    try {
      return localStorage.getItem(STORAGE.starDismissed) === "1";
    } catch {
      return false;
    }
  });

  if (hidden) return null;

  const dismiss = () => {
    setHidden(true);
    try {
      localStorage.setItem(STORAGE.starDismissed, "1");
    } catch {
      /* private mode: gone for this session, which is enough */
    }
  };

  return (
    <div
      data-testid="star-card"
      className="flex items-start gap-3 rounded-2xl border border-border bg-card/95 p-3 text-sm shadow-lg backdrop-blur"
    >
      <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-amber-400/12">
        <Star size={18} className="text-amber-500" />
      </span>

      <div className="min-w-0 flex-1">
        <p className="font-medium">{t("star.title")}</p>
        <p className="mt-0.5 text-[13px] leading-snug text-muted-fg">{t("star.desc")}</p>
        <a
          href={LINKS.repo}
          target="_blank"
          rel="noopener noreferrer"
          onClick={dismiss}
          className="mt-2.5 inline-flex items-center gap-2 rounded-lg bg-foreground px-3 py-1.5 text-[13px] font-medium text-background transition-opacity hover:opacity-90"
        >
          <Star size={14} />
          {t("star.cta")}
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
