import type { Result } from "@apx/protocol";
import { Button, Icons, Meter, Popover } from "@apx/ui";
import { useEffect, useState } from "react";
import { client } from "../data/client.ts";
import { currentLocale, type MessageKey, usePack, useT } from "../i18n/index.ts";
import "../styles/usage.css";
import { windowLabel } from "./engineUsageModel.ts";
import { go } from "./nav.ts";

type Report = Result<"engines.usage">;
const NOTES: Record<string, MessageKey> = {
  claude: "engineUsage.claudeNote",
  opencode: "engineUsage.opencodeNote",
  "acp:opencode": "engineUsage.opencodeNote",
  antigravity: "engineUsage.antigravityNote",
};

export default function EngineUsageButton() {
  const t = useT();
  const [open, setOpen] = useState(false);
  return (
    <Popover
      align="end"
      width={360}
      className="usage-popover"
      open={open}
      onOpenChange={setOpen}
      label={t("engineUsage.title")}
      trigger={
        <button
          type="button"
          className="engine-usage-trigger topbar__icon"
          aria-label={t("engineUsage.title")}
          data-testid="engine-usage-button"
        >
          <Icons.Zap size={14} />
          <span>{t("engineUsage.button")}</span>
        </button>
      }
    >
      {open && <EngineUsageContent onClose={() => setOpen(false)} />}
    </Popover>
  );
}

function EngineUsageContent({ onClose }: { onClose: () => void }) {
  const [generation, setGeneration] = useState(0);
  return usePack("usage") ? (
    <EngineUsageSummary key={generation} onClose={onClose} onRefresh={() => setGeneration((n) => n + 1)} />
  ) : null;
}

function EngineUsageSummary({ onClose, onRefresh }: { onClose: () => void; onRefresh: () => void }) {
  const t = useT();
  const [report, setReport] = useState<Report>();
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let active = true;
    setFailed(false);
    setReport(undefined);
    void client.call("engines.usage", {}).then(
      (result) => {
        if (active) setReport(result);
      },
      () => {
        if (active) setFailed(true);
      },
    );
    return () => {
      active = false;
    };
  }, []);
  return (
    <div
      className="usage usage--compact engine-usage"
      data-testid="engine-usage-summary"
      aria-busy={!report && !failed}
    >
      <div className="usage__headrow">
        <h2 className="usage__head">
          <Icons.Zap size={14} />
          {t("engineUsage.title")}
        </h2>
        <Button size="sm" variant="ghost" disabled={!report && !failed} onClick={onRefresh}>
          {t("sysUsage.refresh")}
        </Button>
      </div>
      <p className="usage__note">{t("engineUsage.description")}</p>
      {!report && !failed && (
        <p className="usage__note" role="status">
          {t("engineUsage.loading")}
        </p>
      )}
      {failed && (
        <p className="usage__error" role="alert">
          {t("engineUsage.failed")}
        </p>
      )}
      {report && !report.engines.length && <p className="usage__note">{t("engineUsage.empty")}</p>}
      {report?.engines.map((engine) => (
        <EngineBlock key={engine.id} engine={engine} />
      ))}
      {report && <p className="usage__note">{t("engineUsage.updated", { at: dateLabel(report.checked_at) })}</p>}
      <p className="usage__note">{t("engineUsage.disclaimer")}</p>
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
        <h3 className="usage__head">{engine.label}</h3>
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
      {engine.available && engine.source === "codex_app_server" && (
        <p className="usage__note">{t("engineUsage.codexSource")}</p>
      )}
      {engine.available && engine.source === "claude_cli" && (
        <p className="usage__note">{t("engineUsage.claudeSource")}</p>
      )}
      {note && <p className="usage__note">{t(note)}</p>}
    </section>
  );
}
