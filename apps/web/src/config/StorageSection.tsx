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
import { StorageCompact } from "./StorageCompact.tsx";
import { BackupItems, ComputerItems } from "./StorageItems.tsx";

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
  /** Areas opened to show each thing in them: the agents' computers, the backups. */
  const [open, setOpen] = useState<ReadonlySet<string>>(new Set());
  const toggle = (id: string) =>
    setOpen((was) => {
      const next = new Set(was);
      if (!next.delete(id)) next.add(id);
      return next;
    });
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

  const freed = () => {
    void loadDiskStatus();
    void load(true);
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
              {usage?.areas.map((a) => {
                const each = a.id === "computers" || a.id === "backups" ? a.id : undefined;
                const name = t(`sysUsage.part.${a.id}`);
                return (
                  <li key={a.id} className={each ? "usage__group" : undefined}>
                    <div className="usage__row">
                      {each ? (
                        <button
                          type="button"
                          className="usage__name usage__toggle"
                          aria-expanded={open.has(each)}
                          onClick={() => toggle(each)}
                        >
                          {open.has(each) ? <Icons.ChevronDown size={14} /> : <Icons.ChevronRight size={14} />}
                          {name}
                        </button>
                      ) : (
                        <span className="usage__name">{name}</span>
                      )}
                      <span className="usage__bar" aria-hidden="true">
                        <span style={{ width: `${max ? (a.bytes / max) * 100 : 0}%` }} />
                      </span>
                      <span className="usage__value">{human(a.bytes)}</span>
                    </div>
                    {each === "computers" && open.has(each) && <ComputerItems onFreed={freed} />}
                    {each === "backups" && open.has(each) && <BackupItems onFreed={freed} />}
                  </li>
                );
              })}
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
      <StorageCompact onDone={freed} />
    </>
  );
}
