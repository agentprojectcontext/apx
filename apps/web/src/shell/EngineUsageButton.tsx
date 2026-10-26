import type { Result } from "@apx/protocol";
import { IconButton, Icons, Popover } from "@apx/ui";
import { Suspense, useEffect, useMemo, useState } from "react";
import { client } from "../data/client.ts";
import { useData } from "../data/state.ts";
import { usePack, useT } from "../i18n/index.ts";
import { EngineUsageSummary } from "../lazy.ts";
import EngineUsageQuick, { quickWindows } from "./EngineUsageQuick.tsx";
import { UsageLoading } from "./UsageLoading.tsx";
import { useVisible } from "./useVisible.ts";
import "../styles/usage.css";
import { sharedUsageRequest } from "./engineUsageRequest.ts";

type Report = Result<"engines.usage">;

export default function EngineUsageButton() {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [quick, setQuick] = useState<Report>();
  const visible = useVisible();
  const load = useMemo(() => sharedUsageRequest(() => client.call("engines.usage", {})), []);
  useEffect(() => {
    if (!visible || open) return;
    let active = true;
    const read = () =>
      void load().then(
        (report) => {
          if (active) setQuick(report);
        },
        () => {
          if (active) setQuick(undefined);
        },
      );
    read();
    const timer = setInterval(read, 60_000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [visible, open, load]);
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
          icon={
            <>
              <span className="engine-usage-trigger__fallback">
                <Icons.Zap size={14} />
              </span>
              {previews.length ? (
                <EngineUsageQuick report={quick} />
              ) : (
                <span className="engine-usage-trigger__label">{t("engineUsage.button")}</span>
              )}
            </>
          }
        />
      }
    >
      {open && <EngineUsageContent onClose={() => setOpen(false)} onReport={setQuick} load={load} />}
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
  const engines = useData((s) => s.engines);
  const [enabled, setEnabled] = useState<Record<string, boolean>>();
  useEffect(() => {
    let active = true;
    void client.call("engines.usage_preferences", {}).then(
      (prefs) => {
        if (active) setEnabled(prefs.engines);
      },
      () => undefined,
    );
    return () => {
      active = false;
    };
  }, []);
  const labels = Object.entries(enabled ?? {})
    .filter(([, selected]) => selected)
    .map(
      ([id]) => engines.find((engine) => (engine.id === "acp:opencode" ? "opencode" : engine.id) === id)?.label ?? "",
    );
  const slots = enabled ? labels.length : 1;
  const preview = <UsageLoading labels={labels} slots={slots} />;
  return usePack("usage") ? (
    <Suspense fallback={preview}>
      <EngineUsageSummary
        key={generation}
        onClose={onClose}
        onReport={onReport}
        load={load}
        onRefresh={() => setGeneration((n) => n + 1)}
        labels={labels}
        slots={slots}
      />
    </Suspense>
  ) : (
    preview
  );
}
