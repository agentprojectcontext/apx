import type { Result } from "@apx/protocol";
import { EngineIcon, Help, IconButton, Icons, Meter } from "@apx/ui";
import { useEffect, useState } from "react";
import { dayLabel } from "../common/format.ts";
import { currentLocale, type MessageKey, useT } from "../i18n/index.ts";
import { BarShowChoice } from "./BarShowChoice.tsx";
import { remainingPercent, resetLabel, tightestWindow, windowLabel } from "./engineUsageModel.ts";
import { go } from "./nav.ts";
import { UsageLoading } from "./UsageLoading.tsx";

type Report = Result<"engines.usage">;
const NOTES: Record<string, MessageKey> = {
  claude: "engineUsage.claudeNote",
  opencode: "engineUsage.opencodeNote",
  "acp:opencode": "engineUsage.opencodeNote",
  antigravity: "engineUsage.antigravityNote",
};

export default function EngineUsageSummary({
  onClose,
  onReport,
  onRefresh,
  load,
}: {
  onClose: () => void;
  onReport: (report: Report | undefined) => void;
  onRefresh: () => void;
  load: () => Promise<Report>;
}) {
  const t = useT();
  const [loading, setLoading] = useState(true);
  const [report, setReport] = useState<Report>();
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let active = true;
    setFailed(false);
    setLoading(true);
    void load().then(
      (result) => {
        if (active) {
          setReport(result);
          onReport(result);
          setLoading(false);
        }
      },
      () => {
        if (active) {
          setFailed(true);
          onReport(undefined);
          setLoading(false);
        }
      },
    );
    return () => {
      active = false;
    };
  }, [onReport, load]);
  return (
    <div className="usage usage--compact engine-usage" data-testid="engine-usage-summary" aria-busy={loading}>
      <div className="usage__headrow">
        <div className="usage__head">
          <h2 className="usage__head">{t("engineUsage.title")}</h2>
          <Help label={t("engineUsage.help")} align="end">
            <p>{t("engineUsage.description")}</p>
            <p>{t("engineUsage.disclaimer")}</p>
          </Help>
        </div>
        <div className="engine-usage__checked">
          {!loading && !failed && report && (
            <span className="usage__note" title={t("engineUsage.updated", { at: dateLabel(report.checked_at) })}>
              {dayLabel(report.checked_at)}
            </span>
          )}
          <IconButton
            size="sm"
            label={t("sysUsage.refresh")}
            icon={<Icons.RefreshCw size={13} />}
            disabled={loading}
            onClick={onRefresh}
          />
        </div>
      </div>
      {loading && (
        <>
          <span className="apx-sr-only" role="status">
            {t("engineUsage.loading")}
          </span>
          <UsageLoading slots={1} />
        </>
      )}
      {failed && (
        <p className="usage__error" role="alert">
          {t("engineUsage.failed")}
        </p>
      )}
      {!loading && !failed && report && !report.engines.length && (
        <p className="usage__note">{t("engineUsage.empty")}</p>
      )}
      {!loading && !failed && report?.engines.map((engine) => <EngineBlock key={engine.id} engine={engine} />)}
      <button
        type="button"
        className="usage__more"
        onClick={() => {
          onClose();
          go.config("engines");
        }}
      >
        {t("engineUsage.engines")}
        <Icons.ChevronRight size={14} />
      </button>
      <BarShowChoice pref="quotaBar" />
    </div>
  );
}

function dateLabel(at: string): string {
  return new Date(at).toLocaleString(currentLocale(), {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** One engine as a row: its mark, name and what is left of its tightest window, the bar, and when it resets. */
function EngineBlock({ engine }: { engine: Report["engines"][number] }) {
  const t = useT();
  const note = NOTES[engine.id];
  const tightest = engine.available ? tightestWindow(engine.windows) : undefined;
  const others = engine.available ? engine.windows.filter((w) => w !== tightest) : [];
  return (
    <section className="usage__block engine-usage__engine">
      <div className="engine-usage__row">
        <EngineIcon engine={engine.id} tile size={16} />
        <h3 className="engine-usage__name">{engine.label}</h3>
        {(note || (engine.available && ["codex_app_server", "claude_cli"].includes(engine.source ?? ""))) && (
          <Help label={t("engineUsage.engineHelp", { engine: engine.label })} align="end">
            {engine.available && engine.source === "codex_app_server" && <p>{t("engineUsage.codexSource")}</p>}
            {engine.available && engine.source === "claude_cli" && <p>{t("engineUsage.claudeSource")}</p>}
            {note && <p>{t(note)}</p>}
          </Help>
        )}
        <span className="usage__figure engine-usage__left">
          {tightest
            ? t("quota.free", { pct: remainingPercent(tightest) })
            : !engine.available &&
              t(
                !engine.cli_installed
                  ? "engineUsage.notInstalled"
                  : engine.reason === "unsupported"
                    ? "engineUsage.unsupported"
                    : "engineUsage.unavailable",
              )}
        </span>
      </div>
      {tightest && (
        <>
          <Meter
            size="sm"
            label={`${engine.label} · ${windowLabel(tightest, t)}`}
            value={tightest.used_percent}
            max={100}
            valueText={t("engineUsage.used", { pct: Math.round(tightest.used_percent) })}
          />
          <p className="usage__note">
            {[
              windowLabel(tightest, t),
              tightest.resets_at && resetLabel(tightest.resets_at, new Date(), currentLocale(), t),
            ]
              .filter(Boolean)
              .join(" · ")}
          </p>
        </>
      )}
      {others.map((window) => (
        <p className="usage__note" key={window.id}>
          {[
            windowLabel(window, t),
            t("quota.free", { pct: remainingPercent(window) }),
            window.resets_at && resetLabel(window.resets_at, new Date(), currentLocale(), t),
          ]
            .filter(Boolean)
            .join(" · ")}
        </p>
      ))}
    </section>
  );
}
