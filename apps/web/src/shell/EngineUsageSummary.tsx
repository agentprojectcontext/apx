import type { Result } from "@apx/protocol";
import { Button, Help, Icons, Meter } from "@apx/ui";
import { useEffect, useState } from "react";
import { currentLocale, type MessageKey, useT } from "../i18n/index.ts";
import { windowLabel } from "./engineUsageModel.ts";
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
          <h2 className="usage__head">
            <Icons.Zap size={14} />
            {t("engineUsage.title")}
          </h2>
          <Help label={t("engineUsage.help")} align="end">
            <p>{t("engineUsage.description")}</p>
            <p>{t("engineUsage.disclaimer")}</p>
          </Help>
        </div>
        <Button size="sm" variant="ghost" disabled={loading} onClick={onRefresh}>
          {t("sysUsage.refresh")}
        </Button>
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
      {!loading && !failed && report && (
        <p className="usage__note">{t("engineUsage.updated", { at: dateLabel(report.checked_at) })}</p>
      )}
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

function EngineBlock({ engine }: { engine: Report["engines"][number] }) {
  const t = useT();
  const note = NOTES[engine.id];
  return (
    <section className="usage__block engine-usage__engine">
      <div className="usage__headrow">
        <div className="usage__head">
          <h3 className="usage__head">{engine.label}</h3>
          {(note || (engine.available && ["codex_app_server", "claude_cli"].includes(engine.source ?? ""))) && (
            <Help label={t("engineUsage.engineHelp", { engine: engine.label })} align="end">
              {engine.available && engine.source === "codex_app_server" && <p>{t("engineUsage.codexSource")}</p>}
              {engine.available && engine.source === "claude_cli" && <p>{t("engineUsage.claudeSource")}</p>}
              {note && <p>{t(note)}</p>}
            </Help>
          )}
        </div>
        {!engine.available && (
          <span className="usage__state">
            {t(
              !engine.cli_installed
                ? "engineUsage.notInstalled"
                : engine.reason === "unsupported"
                  ? "engineUsage.unsupported"
                  : "engineUsage.unavailable",
            )}
          </span>
        )}
      </div>
      {engine.available &&
        engine.windows.map((window) => (
          <div className="usage__block" key={window.id}>
            <div className="usage__headrow">
              <span className="usage__figure">{windowLabel(window, t)}</span>
              <span className="usage__figure">
                {t("engineUsage.remaining", { pct: Math.round(100 - window.used_percent) })}
              </span>
            </div>
            <Meter
              size="sm"
              label={`${engine.label} · ${windowLabel(window, t)}`}
              value={window.used_percent}
              max={100}
              valueText={t("engineUsage.used", { pct: Math.round(window.used_percent) })}
            />
            {window.resets_at && (
              <p className="usage__note">{t("engineUsage.resets", { at: dateLabel(window.resets_at) })}</p>
            )}
          </div>
        ))}
    </section>
  );
}
