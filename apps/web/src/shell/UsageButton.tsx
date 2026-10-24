import { Icons, Popover } from "@apx/ui";
import { Suspense, useState } from "react";
import { useUsage } from "../data/usage.ts";
import { useT } from "../i18n/index.ts";
import { UsageSummary } from "../lazy.ts";
import { useVisible } from "./useVisible.ts";

/** Topbar gauge: how full the computer's RAM is. Opens a compact view of RAM, CPU, disk and APX's top consumers. */
export function UsageButton() {
  const t = useT();
  const [open, setOpen] = useState(false);
  const visible = useVisible();
  // Closed, a light read now and then keeps the gauge true; nothing while the window is hidden.
  const { usage } = useUsage(visible ? { detail: false, every: 30_000 } : undefined);
  const host = usage?.host;
  const pct = host?.memory_total_mb
    ? Math.round(((host.memory_total_mb - host.memory_available_mb) / host.memory_total_mb) * 100)
    : undefined;
  const tone = pct === undefined ? "" : pct >= 92 ? " is-danger" : pct >= 80 ? " is-warning" : "";
  return (
    <Popover
      align="end"
      width={340}
      open={open}
      onOpenChange={setOpen}
      label={t("sysUsage.title")}
      trigger={
        <button
          type="button"
          className={`usage-btn${tone}`}
          aria-label={pct === undefined ? t("sysUsage.title") : t("sysUsage.button", { pct })}
          data-testid="usage-button"
        >
          <Icons.MemoryStick size={14} />
          {pct !== undefined && (
            <>
              <span className="usage-btn__gauge" aria-hidden="true">
                <span style={{ width: `${pct}%` }} />
              </span>
              <span className="usage-btn__pct">{pct}%</span>
            </>
          )}
        </button>
      }
    >
      {open && (
        <Suspense fallback={null}>
          <UsageSummary onClose={() => setOpen(false)} />
        </Suspense>
      )}
    </Popover>
  );
}
