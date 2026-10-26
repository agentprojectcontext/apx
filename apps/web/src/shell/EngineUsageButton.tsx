import type { Result } from "@apx/protocol";
import { IconButton, Icons, Popover, Skeleton } from "@apx/ui";
import { useCallback, useEffect, useMemo, useState } from "react";
import { client } from "../data/client.ts";
import { usePack, useT } from "../i18n/index.ts";
import EngineUsageQuick, { quickWindows } from "./EngineUsageQuick.tsx";
import EngineUsageSummary from "./EngineUsageSummary.tsx";
import { UsageLoading } from "./UsageLoading.tsx";
import { useVisible } from "./useVisible.ts";
import "../styles/usage.css";
import { sharedUsageRequest } from "./engineUsageRequest.ts";

type Report = Result<"engines.usage">;

export default function EngineUsageButton() {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [quick, setQuick] = useState<Report>();
  const [loading, setLoading] = useState(true);
  const onReport = useCallback((report: Report | undefined) => {
    setQuick(report);
    setLoading(false);
  }, []);
  const visible = useVisible();
  const load = useMemo(() => sharedUsageRequest(() => client.call("engines.usage", {})), []);
  useEffect(() => {
    if (!visible || open) return;
    let active = true;
    const read = () =>
      void load().then(
        (report) => {
          if (active) onReport(report);
        },
        () => {
          if (active) onReport(undefined);
        },
      );
    read();
    const timer = setInterval(read, 60_000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [visible, open, load, onReport]);
  const previews = quickWindows(quick);
  const tooltip = [
    t("engineUsage.title"),
    ...previews.map(({ engine, window, remaining }) =>
      t("engineUsage.quick", {
        engine: engine.label,
        pct: remaining,
        window: window.window_minutes ? `${window.window_minutes} min` : window.id,
      }),
    ),
  ].join("\n");
  return (
    <Popover
      align="end"
      width={360}
      className="usage-popover"
      open={open}
      onOpenChange={setOpen}
      label={t("engineUsage.title")}
      trigger={
        <IconButton
          size="sm"
          className="engine-usage-trigger topbar__icon"
          label={t("engineUsage.title")}
          tooltip={tooltip}
          data-testid="engine-usage-button"
          aria-busy={loading}
          icon={
            <>
              <span className="engine-usage-trigger__fallback">
                <Icons.Zap size={14} />
              </span>
              {loading ? (
                <span className="engine-usage-trigger__loading">
                  <Skeleton width="100%" height={14} />
                </span>
              ) : previews.length ? (
                <EngineUsageQuick report={quick} />
              ) : null}
            </>
          }
        />
      }
    >
      {open && <EngineUsageContent onClose={() => setOpen(false)} onReport={onReport} load={load} />}
    </Popover>
  );
}

function EngineUsageContent({
  onClose,
  onReport,
  load,
}: {
  onClose: () => void;
  onReport: (report: Report | undefined) => void;
  load: () => Promise<Report>;
}) {
  const [generation, setGeneration] = useState(0);
  const preview = <UsageLoading slots={1} />;
  return usePack("usage") ? (
    <EngineUsageSummary
      key={generation}
      onClose={onClose}
      onReport={onReport}
      load={load}
      onRefresh={() => setGeneration((n) => n + 1)}
    />
  ) : (
    preview
  );
}
