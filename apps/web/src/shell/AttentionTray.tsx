import { IconButton, Icons, Popover } from "@apx/ui";
import { Suspense, useEffect, useState } from "react";
import { useAttention } from "../data/notifications.ts";
import { useT } from "../i18n/index.ts";
import { AttentionList, loadOsNotices } from "../lazy.ts";

/** Topbar bell: what wants the owner (an agent's question or news, a task waiting, a routine's news, a channel matter). */
export function AttentionTray() {
  const t = useT();
  const unread = useAttention((s) => s.unread);
  const [open, setOpen] = useState(false);
  // Loaded after the first paint: it only matters once a notice arrives, and keeps the initial bundle in budget.
  useEffect(() => {
    let stop: (() => void) | undefined;
    let gone = false;
    void loadOsNotices().then((m) => {
      if (!gone) stop = m.startOsNotices();
    });
    return () => {
      gone = true;
      stop?.();
    };
  }, []);
  useEffect(() => {
    window.apxDesktop?.setAttention?.(unread);
  }, [unread]);
  return (
    <Popover
      align="end"
      width={360}
      open={open}
      onOpenChange={setOpen}
      label={t("topbar.notifications")}
      trigger={
        <IconButton
          size="sm"
          className={unread ? "attention has-unread" : "attention"}
          label={t("attention.aria", { n: unread })}
          icon={
            <>
              <span className="attention__bell">
                <Icons.Bell size={16} />
                {unread > 0 && <span className="attention__dot" />}
              </span>
              {unread > 0 && <span className="attention__count">{unread > 99 ? "99+" : unread}</span>}
            </>
          }
        />
      }
    >
      <Suspense fallback={null}>
        <AttentionList onOpened={() => setOpen(false)} />
      </Suspense>
    </Popover>
  );
}
