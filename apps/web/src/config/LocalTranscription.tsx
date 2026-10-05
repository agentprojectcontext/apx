import type { LocalTranscription as Local } from "@apx/protocol";
import { Button, Icons, Select } from "@apx/ui";
import { useCallback, useEffect, useState } from "react";
import { client } from "../data/client.ts";
import { notify } from "../data/notices.ts";
import { type MessageKey, useT } from "../i18n/index.ts";

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));
const QUALITY: Record<Local["models"][number]["quality"], MessageKey> = {
  basic: "local.quality.basic",
  good: "local.quality.good",
  great: "local.quality.great",
};

/**
 * Transcription on this machine, installed from here: what it runs well (a Mac's GPU, or the CPU), the model that
 * fits, downloaded when the owner installs it. `onInstalled` refreshes the list of services below.
 */
export function LocalTranscription({ onInstalled }: { onInstalled(): void }) {
  const t = useT();
  const [s, setS] = useState<Local>();
  const [pick, setPick] = useState<string>();
  const load = useCallback(async () => {
    try {
      const next = await client.call("transcription.local", {});
      setS((prev) => {
        if (prev?.download && !next.download) onInstalled();
        return next;
      });
      setPick((p) => p ?? next.active ?? next.recommended);
    } catch {
      setS(undefined);
    }
  }, [onInstalled]);
  useEffect(() => {
    void load();
  }, [load]);
  const busy = Boolean(s?.download && !s.download.error);
  useEffect(() => {
    if (!busy) return;
    const iv = setInterval(() => void load(), 1000);
    return () => clearInterval(iv);
  }, [busy, load]);
  if (!s) return null;

  const install = async () => {
    if (!pick) return;
    try {
      const next = await client.call("transcription.install", { model: pick });
      setS(next);
      if (!next.download) onInstalled();
    } catch (e) {
      notify(t("error.services", { error: errText(e) }));
    }
  };
  const m = s.machine;
  const d = s.download;
  const pct = d?.total ? Math.floor((d.received / d.total) * 100) : 0;
  return (
    <div className="localstt">
      <div className="localstt__head">
        <Icons.Mic size={16} />
        <span className="localstt__title">{t("local.title")}</span>
        {s.active && <span className="localstt__active">{t("local.active", { model: s.active })}</span>}
      </div>
      <p className="localstt__machine">
        {m.accel === "metal"
          ? t("local.machine.metal")
          : t("local.machine.cpu", { cores: m.cores, memory: m.memory_gb })}
      </p>
      {s.install_hint && (
        <p className="localstt__hint">
          {t("local.missing")} <code>{s.install_hint}</code>
        </p>
      )}
      <div className="localstt__row">
        <Select
          label={t("local.model")}
          value={pick ?? null}
          onValueChange={(v) => setPick(v ?? undefined)}
          options={s.models.map((x) => ({
            value: x.id,
            label: x.id,
            hint: `${x.mb} MB${x.installed ? ` · ${t("local.onDisk")}` : ""}`,
            description: `${t(QUALITY[x.quality])}${x.id === s.recommended ? ` · ${t("local.recommended")}` : ""}`,
          }))}
        />
        <Button loading={busy} disabled={!pick || (pick === s.active && !d)} onClick={() => void install()}>
          {pick === s.active ? t("local.inUse") : t("local.install")}
        </Button>
      </div>
      {d && !d.error && (
        <div
          className="localstt__progress"
          role="progressbar"
          aria-valuenow={pct}
          aria-valuemin={0}
          aria-valuemax={100}
        >
          <span style={{ width: `${pct}%` }} />
          <small>{t("local.downloading", { model: d.model, pct })}</small>
        </div>
      )}
      {d?.error && <p className="localstt__error">{t("local.failed", { error: d.error })}</p>}
    </div>
  );
}
