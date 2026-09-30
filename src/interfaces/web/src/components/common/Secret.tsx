import { useState } from "react";
import { Eye, EyeOff } from "lucide-react";
import { Button } from "../ui";
import { cn } from "../../lib/cn";
import { t } from "../../i18n";

/**
 * A value that is blurred until you ask for it, with the eye right after the
 * text rather than out in the row of actions — the eye belongs to the value,
 * not to the row.
 *
 * This exists for screen recordings and screen sharing: a tailnet name or a
 * tailnet IP is an address into someone's private network, and it is on screen
 * the whole time the panel is open. Blurring is cosmetic (the value is still
 * in the DOM, and copy still copies it) — it protects a frame of video, not a
 * secret from a reader of the page.
 *
 * Pass `revealed`/`onToggle` to share one eye's state across several values;
 * leave them out and each value keeps its own.
 */
export function Secret({
  value,
  revealed: controlled,
  onToggle,
  className,
}: {
  value: string;
  revealed?: boolean;
  onToggle?: () => void;
  className?: string;
}) {
  const [own, setOwn] = useState(false);
  const revealed = controlled ?? own;
  const toggle = onToggle ?? (() => setOwn((v) => !v));

  return (
    <span className={cn("inline-flex min-w-0 items-center gap-1", className)}>
      <span
        className={cn(
          "min-w-0 truncate transition-[filter,opacity] duration-200",
          !revealed && "select-none blur-[5px] opacity-70",
        )}
      >
        {value}
      </span>
      <Button
        size="sm"
        variant="ghost"
        className="h-6 shrink-0 px-1"
        onClick={toggle}
        aria-label={t(revealed ? "access.hide" : "access.reveal")}
        title={t(revealed ? "access.hide" : "access.reveal")}
      >
        {revealed ? <EyeOff size={13} /> : <Eye size={13} />}
      </Button>
    </span>
  );
}
