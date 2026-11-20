import type { TELEMETRY_STAGES, UsageStats } from "@apx/protocol";
import { SettingRow, Switch } from "@apx/ui";
import { useEffect } from "react";
import { formatNumber } from "../common/format.ts";
import { PRIVACY_URL, refreshTelemetry, setUsage, useTelemetry } from "../data/telemetry.ts";
import { useT } from "../i18n/index.ts";
import { SubHead } from "./SectionHead.tsx";

type Stat = Exclude<keyof UsageStats, "extensions">;
const STATS: Stat[] = ["tokens_in", "tokens_out", "runs", "projects", "agents", "channels", "routines"];
/** Counted as they happen: shown only once one happened, as the report leaves them out until then. */
const COUNTS: Stat[] = [
  "searches",
  "searches_empty",
  "installs_official",
  "installs_catalog",
  "installs_file",
  "installs_url",
  "installs_folder",
  "installs_server",
  "signins",
  "public_artifacts",
  "public_links",
];

/** Usage statistics in Advanced: the owner's answer, what the next report holds and what already left, as sent. */
export function TelemetryBlock() {
  const t = useT();
  const state = useTelemetry((s) => s.state);
  useEffect(() => {
    void refreshTelemetry();
  }, []);
  if (!state) return null;
  const steps = Object.entries(state.sent) as Array<[(typeof TELEMETRY_STAGES)[number], string]>;
  return (
    <>
      <SubHead>{t("telemetry.title")}</SubHead>
      <p className="config__lead">
        {state.enabled ? t("telemetry.lead") : t("telemetry.off")}{" "}
        <a href={PRIVACY_URL} target="_blank" rel="noopener noreferrer">
          {t("telemetry.whatIsSent")}
        </a>
      </p>
      {state.enabled && (
        <SettingRow title={t("telemetry.check")} description={t("telemetry.checkHint")}>
          <Switch
            checked={state.usage === true}
            onCheckedChange={(on) => void setUsage(on)}
            aria-label={t("telemetry.check")}
          />
        </SettingRow>
      )}
      <dl className="kv">
        <div className="kv__row">
          <dt>{t("telemetry.id")}</dt>
          <dd className="kv__mono">{state.install_id}</dd>
        </div>
        <div className="kv__row">
          <dt>{t("telemetry.steps")}</dt>
          <dd>{steps.length ? steps.map(([s]) => t(`telemetry.stage.${s}`)).join(" · ") : t("telemetry.never")}</dd>
        </div>
      </dl>
      <p className="config__lead telemetry__preview">{t("telemetry.preview")}</p>
      <dl className="kv">
        {[...STATS, ...COUNTS.filter((k) => state.preview[k])].map((k) => (
          <div key={k} className="kv__row">
            <dt>{t(`telemetry.stat.${k}`)}</dt>
            <dd className="kv__mono">{formatNumber(state.preview[k] ?? 0)}</dd>
          </div>
        ))}
        {state.preview.extensions?.length ? (
          <div className="kv__row">
            <dt>{t("telemetry.stat.extensions")}</dt>
            <dd className="kv__mono">{state.preview.extensions.join(", ")}</dd>
          </div>
        ) : null}
      </dl>
      {state.last && (
        <details className="telemetry__last">
          <summary>
            {t("telemetry.last")} · {new Date(state.last.at).toLocaleString()}
          </summary>
          <pre className="kv__mono">{JSON.stringify(state.last.event, null, 2)}</pre>
        </details>
      )}
    </>
  );
}
