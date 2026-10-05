import { Badge, Button, Icons, Skeleton } from "@apx/ui";
import { useCallback, useEffect, useState } from "react";
import { client } from "../data/client.ts";
import { loadHealth } from "../data/engines.ts";
import { useData } from "../data/state.ts";
import { isKey, useT } from "../i18n/index.ts";
import { SectionHead, SubHead } from "./SectionHead.tsx";

const STATUS_TONE = { ok: "brand", degraded: "warning", down: "danger", off: "neutral" } as const;

/** Advanced: where the panel is connected, which code the core runs, and what each part is doing. */
export function AdvancedSection() {
  const t = useT();
  const health = useData((s) => s.health);
  const connection = useData((s) => s.connection);
  useEffect(() => {
    void loadHealth();
  }, []);
  const rows: [string, string][] = health
    ? [
        [t("advanced.core"), window.location.origin],
        [t("advanced.version"), health.version],
        [t("advanced.code"), health.code_sha],
        [t("advanced.protocol"), String(health.protocol)],
        [t("advanced.install"), health.home_id],
        [t("advanced.uptime"), uptime(health.uptime_s)],
      ]
    : [[t("advanced.core"), window.location.origin]];
  return (
    <>
      <SectionHead
        title={t("config.advanced")}
        lead={t("advanced.lead")}
        actions={
          <Button
            size="sm"
            variant="secondary"
            leadingIcon={<Icons.RefreshCw size={14} />}
            onClick={() => void loadHealth()}
          >
            {t("common.refresh")}
          </Button>
        }
      />
      <dl className="kv">
        <div className="kv__row">
          <dt>{t("advanced.connection")}</dt>
          <dd>
            <Badge tone={connection === "online" ? "brand" : connection === "offline" ? "danger" : "neutral"} dot>
              {connection === "online"
                ? t("connection.online")
                : connection === "offline"
                  ? t("connection.offline")
                  : t("connection.connecting")}
            </Badge>
          </dd>
        </div>
        {rows.map(([k, v]) => (
          <div key={k} className="kv__row">
            <dt>{k}</dt>
            <dd className="kv__mono">{v}</dd>
          </div>
        ))}
      </dl>
      <SubHead>{t("advanced.subsystems")}</SubHead>
      <p className="config__lead">{t("advanced.subsystemsHint")}</p>
      {health ? (
        <ul className="res__list">
          {Object.entries(health.subsystems).map(([name, st]) => {
            const label = `advanced.sub.${name}`;
            const what = `advanced.sub.${name}.hint`;
            return (
              <li key={name} className="res__row">
                <div className="res__main">
                  <div className="res__name">{isKey(label) ? t(label) : name}</div>
                  <div className="res__desc">
                    {[isKey(what) ? t(what) : "", st.status !== "off" && st.detail].filter(Boolean).join(" · ")}
                  </div>
                </div>
                <Badge tone={STATUS_TONE[st.status]} dot>
                  {t(`advanced.status.${st.status}`)}
                </Badge>
              </li>
            );
          })}
        </ul>
      ) : (
        <Skeleton shape="block" height={120} />
      )}
      <MemoryUsage />
    </>
  );
}

function uptime(s: number): string {
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return h ? `${h} h ${m} min` : `${m} min`;
}

type Usage = { label: string; mb: number };
const size = (mb: number) => (mb >= 1024 ? `${(mb / 1024).toFixed(1)} GB` : `${mb} MB`);

/** What APX takes in RAM, process by process (the core too), to tell which one grows. */
function MemoryUsage() {
  const t = useT();
  const [rows, setRows] = useState<Usage[]>();
  const read = useCallback(async () => {
    const [app, health] = await Promise.all([
      window.apxDesktop?.memory?.().catch(() => undefined),
      client.call("system.health", {}).catch(() => undefined),
    ]);
    const core = health?.rss_mb ? [{ label: t("desktop.memory.core"), mb: health.rss_mb }] : [];
    const own = (app?.items ?? []).map((i) => ({
      label: `${t(`desktop.memory.${i.kind}`)}${i.site ? ` · ${i.site}` : ""}`,
      mb: i.mb,
    }));
    setRows([...core, ...own].sort((a, b) => b.mb - a.mb));
  }, [t]);
  useEffect(() => {
    void read();
    const id = setInterval(() => void read(), 10_000);
    return () => clearInterval(id);
  }, [read]);
  if (!rows?.length) return null;
  const total = rows.reduce((n, r) => n + r.mb, 0);
  return (
    <>
      <SubHead>{t("desktop.memory")}</SubHead>
      <p className="config__lead">{t("desktop.memoryHint", { total: size(total) })}</p>
      <ul className="res__list">
        {rows.slice(0, 12).map((r, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: two helpers can share a label
          <li key={i} className="res__row">
            <div className="res__main">
              <div className="res__name">{r.label}</div>
            </div>
            <span className="res__desc">{size(r.mb)}</span>
          </li>
        ))}
      </ul>
    </>
  );
}
