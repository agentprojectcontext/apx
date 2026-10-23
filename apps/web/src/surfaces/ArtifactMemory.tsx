import type { ArtifactMemory as Memory, SurfaceSummary } from "@apx/protocol";
import { Button, Checkbox, Dialog, IconButton, Icons, SettingRow, Skeleton, Tag } from "@apx/ui";
import { useEffect, useState } from "react";
import { formatBytes, formatNumber } from "../common/format.ts";
import { artifactMemory, clearArtifactMemory, exportArtifact, type MemoryPart } from "../data/artifacts.ts";
import { useT } from "../i18n/index.ts";
import "../styles/artifacts.css";

/** Store keys shown by name; the rest are counted. */
const KEYS_SHOWN = 12;

/** The artifact's memory button: what it keeps (state, store, database) by size, its export and its clearing. */
export function ArtifactMemoryButton({ surface }: { surface: SurfaceSummary }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  return (
    <>
      <IconButton
        size="sm"
        label={t("artifact.memory")}
        icon={<Icons.Database size={14} />}
        onClick={() => setOpen(true)}
      />
      {open && <ArtifactMemoryDialog surface={surface} onClose={() => setOpen(false)} />}
    </>
  );
}

export function ArtifactMemoryDialog({ surface, onClose }: { surface: SurfaceSummary; onClose: () => void }) {
  const t = useT();
  const [memory, setMemory] = useState<Memory>();
  const [withMemory, setWithMemory] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [clearing, setClearing] = useState<Set<MemoryPart>>();
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let live = true;
    void artifactMemory(surface.id).then((m) => live && setMemory(m));
    return () => {
      live = false;
    };
  }, [surface.id]);

  const parts: { part: MemoryPart; title: string; size: string; empty: boolean }[] = memory
    ? [
        {
          part: "state",
          title: t("artifact.state"),
          size: t("artifact.stateSize", { n: formatNumber(memory.state_chars) }),
          empty: memory.state_chars <= 2,
        },
        {
          part: "store",
          title: t("artifact.store"),
          size: t(memory.store.keys.length === 1 ? "artifact.storeSize.one" : "artifact.storeSize.other", {
            n: formatNumber(memory.store.keys.length),
            size: formatBytes(memory.store.bytes),
          }),
          empty: memory.store.keys.length === 0,
        },
        {
          part: "db",
          title: t("artifact.db"),
          size: t(memory.db.tables.length === 1 ? "artifact.dbSize.one" : "artifact.dbSize.other", {
            n: formatNumber(memory.db.tables.length),
            size: formatBytes(memory.db.bytes),
          }),
          empty: memory.db.bytes === 0,
        },
        {
          part: "secrets",
          title: t("artifact.secrets"),
          size: t("artifact.secretsSize", { n: formatNumber(memory.secrets.length) }),
          empty: memory.secrets.length === 0,
        },
      ]
    : [];

  const startClear = () => setClearing(new Set(parts.filter((p) => !p.empty).map((p) => p.part)));
  const toggle = (part: MemoryPart, on: boolean) =>
    setClearing((cur) => {
      const next = new Set(cur);
      if (on) next.add(part);
      else next.delete(part);
      return next;
    });
  const clear = async () => {
    if (!clearing?.size) return;
    setBusy(true);
    const m = await clearArtifactMemory(surface.id, [...clearing]);
    setBusy(false);
    if (m) setMemory(m);
    setClearing(undefined);
  };
  const doExport = async () => {
    setExporting(true);
    await exportArtifact(surface.id, withMemory);
    setExporting(false);
  };

  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={t("artifact.memoryTitle", { title: surface.title })}
      description={clearing ? t("artifact.clearHint") : t("artifact.memoryHint")}
      closeLabel={t("common.close")}
      footer={
        clearing ? (
          <>
            <Button variant="secondary" onClick={() => setClearing(undefined)}>
              {t("common.cancel")}
            </Button>
            <Button variant="danger" loading={busy} disabled={!clearing.size} onClick={() => void clear()}>
              {t("artifact.clearConfirm")}
            </Button>
          </>
        ) : (
          <>
            <Checkbox label={t("artifact.includeMemory")} checked={withMemory} onCheckedChange={setWithMemory} />
            <span className="artmem__spacer" />
            <Button
              variant="secondary"
              leadingIcon={<Icons.Trash2 size={14} />}
              disabled={!parts.some((p) => !p.empty)}
              onClick={startClear}
            >
              {t("artifact.clear")}
            </Button>
            <Button leadingIcon={<Icons.Download size={14} />} loading={exporting} onClick={() => void doExport()}>
              {t("artifact.export")}
            </Button>
          </>
        )
      }
    >
      {!memory ? (
        <Skeleton shape="block" height={120} />
      ) : clearing ? (
        <div className="artmem__choose">
          {parts.map((p) => (
            <Checkbox
              key={p.part}
              label={p.title}
              description={p.size}
              disabled={p.empty}
              checked={clearing.has(p.part)}
              onCheckedChange={(on) => toggle(p.part, on)}
            />
          ))}
        </div>
      ) : (
        <div className="artmem">
          <SettingRow title={t("artifact.state")} description={t("artifact.stateHint")}>
            <span className="artmem__size">{parts[0]?.size}</span>
          </SettingRow>
          <SettingRow stacked title={t("artifact.store")} description={t("artifact.storeHint")}>
            <div className="artmem__detail">
              <span className="artmem__size">{parts[1]?.size}</span>
              {memory.store.keys.length > 0 && (
                <div className="artmem__tags">
                  {memory.store.keys.slice(0, KEYS_SHOWN).map((k) => (
                    <Tag key={k}>{k}</Tag>
                  ))}
                  {memory.store.keys.length > KEYS_SHOWN && (
                    <span className="artmem__more">
                      {t("artifact.more", { n: formatNumber(memory.store.keys.length - KEYS_SHOWN) })}
                    </span>
                  )}
                </div>
              )}
            </div>
          </SettingRow>
          <SettingRow stacked title={t("artifact.db")} description={t("artifact.dbHint")}>
            <div className="artmem__detail">
              <span className="artmem__size">{parts[2]?.size}</span>
              {memory.db.tables.length > 0 && (
                <ul className="artmem__tables">
                  {memory.db.tables.map((tb) => (
                    <li key={tb.name}>
                      <code>{tb.name}</code>
                      <span>{t("artifact.rows", { n: formatNumber(tb.rows) })}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </SettingRow>
          {memory.secrets.length > 0 && (
            <SettingRow stacked title={t("artifact.secrets")} description={t("artifact.secretsHint")}>
              <ul className="artmem__tables">
                {memory.secrets.map((sc) => (
                  <li key={sc.key}>
                    <code>{sc.key}</code>
                    <span>{sc.origin}</span>
                  </li>
                ))}
              </ul>
            </SettingRow>
          )}
        </div>
      )}
    </Dialog>
  );
}
