import type { StorageUsage } from "@apx/protocol";
import { Button, Icons, Meter, SettingRow, Skeleton } from "@apx/ui";
import { useCallback, useEffect, useRef, useState } from "react";
import "../styles/usage.css";
import { client } from "../data/client.ts";
import { notify } from "../data/notices.ts";
import { loadDiskStatus } from "../data/storage.ts";
import { size } from "../data/usageModel.ts";
import { usePack, useT } from "../i18n/index.ts";
import { SectionHead } from "./SectionHead.tsx";

const MB = 1048576;
const human = (bytes: number) => (bytes > 0 && bytes < MB ? "< 1 MB" : size(bytes / MB));
/** While the home is being measured, it is asked again this often. */
const MEASURING_MS = 1500;

/** Storage: the disk holding APX, what APX keeps on it by area, and freeing what APX makes again. */
export function StorageSection() {
  const own = usePack("storage");
  const areas = usePack("usage");
  return own && areas ? <Storage /> : <Skeleton height={240} shape="block" />;
}

function Storage() {
  const t = useT();
  const [usage, setUsage] = useState<StorageUsage>();
  const [error, setError] = useState<string>();
  const [clearing, setClearing] = useState(false);
  const live = useRef(true);

  const load = useCallback(async (refresh = false) => {
    try {
      const u = await client.call("storage.usage", { refresh });
      if (!live.current) return;
      setUsage(u);
      setError(undefined);
    } catch (e) {
      if (live.current) setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => {
    live.current = true;
    void load();
    return () => {
      live.current = false;
    };
  }, [load]);
  // The walk runs in the background: ask again until it is done.
  useEffect(() => {
    if (!usage?.measuring) return;
    const id = setTimeout(() => void load(), MEASURING_MS);
    return () => clearTimeout(id);
  }, [usage, load]);

  const clear = async () => {
    setClearing(true);
    try {
      const r = await client.call("storage.clear", {});
      notify(t("storage.freed", { size: human(r.freed_bytes) }), "info");
      void loadDiskStatus();
      await load();
    } catch (e) {
      notify(t("storage.failed", { error: e instanceof Error ? e.message : String(e) }));
    } finally {
      setClearing(false);
    }
  };

  const measured = usage?.measured_at !== undefined;
  const disk = usage?.disk;
  const max = usage?.areas[0]?.bytes ?? 0;
  const freeable = usage?.freeable_bytes ?? 0;
  const diskText = disk ? t("storage.diskFree", { free: human(disk.free_bytes), total: human(disk.total_bytes) }) : "";

  return (
    <>
      <SectionHead
        title={t("config.storage")}
        lead={t("storage.lead")}
        actions={
          <Button
            size="sm"
            variant="secondary"
            leadingIcon={<Icons.RefreshCw size={14} />}
            loading={usage?.measuring === true && measured}
            onClick={() => void load(true)}
          >
            {t("common.refresh")}
          </Button>
        }
      />
      {error && !usage && (
        <p className="usage__error" role="alert">
          {t("storage.unavailable", { error })}
        </p>
      )}
      <div className="usage" data-testid="storage">
        {disk && (
          <section className="usage__block usage__disk">
            <div className="usage__headrow">
              <h3 className="usage__head">
                <Icons.HardDrive size={13} />
                {t("storage.disk")}
              </h3>
              <span className="usage__figure">{diskText}</span>
            </div>
            <Meter
              label={t("storage.disk")}
              valueText={diskText}
              value={disk.total_bytes - disk.free_bytes}
              max={disk.total_bytes}
            />
            {disk.low && (
              <p className="usage__error" role="alert">
                {t("storage.diskLow")}
              </p>
            )}
          </section>
        )}
        <section className="usage__block" data-testid="storage-areas">
          <div className="usage__headrow">
            <h3 className="usage__head">
              <Icons.Folder size={13} />
              {t("storage.apx")}
            </h3>
            <span className="usage__figure">{measured ? human(usage?.total_bytes ?? 0) : t("storage.measuring")}</span>
          </div>
          {measured ? (
            <ul className="usage__list">
              {usage?.areas.map((a) => (
                <li key={a.id} className="usage__row">
                  <span className="usage__name">{t(`sysUsage.part.${a.id}`)}</span>
                  <span className="usage__bar" aria-hidden="true">
                    <span style={{ width: `${max ? (a.bytes / max) * 100 : 0}%` }} />
                  </span>
                  <span className="usage__value">{human(a.bytes)}</span>
                </li>
              ))}
            </ul>
          ) : (
            <Skeleton height={120} shape="block" />
          )}
          {usage?.partial && <span className="usage__note">{t("storage.partial")}</span>}
        </section>
      </div>
      <SettingRow title={t("storage.free")} description={t("storage.freeHint")}>
        <Button
          size="sm"
          variant="secondary"
          leadingIcon={<Icons.Trash2 size={14} />}
          disabled={!measured || freeable === 0}
          loading={clearing}
          onClick={() => void clear()}
        >
          {!measured
            ? t("storage.free")
            : freeable > 0
              ? t("storage.freeCta", { size: human(freeable) })
              : t("storage.nothing")}
        </Button>
      </SettingRow>
    </>
  );
}
