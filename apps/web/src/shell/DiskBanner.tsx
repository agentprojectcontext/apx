import { Button, IconButton, Icons } from "@apx/ui";
import { closeCard, useClosedCards } from "../data/cornerCards.ts";
import { diskWarning } from "../data/diskModel.ts";
import { freeText, useDiskStatus } from "../data/storage.ts";
import { useT } from "../i18n/index.ts";
import { go } from "./nav.ts";

/** Where the corner cards do not fit (a phone, no list column): the low-disk warning as a strip under the topbar. */
export function DiskBanner() {
  const t = useT();
  const disk = useDiskStatus();
  const closed = useClosedCards((s) => s.disk);
  if (!disk || diskWarning(disk, closed) !== "card") return null;
  return (
    <div className="offline" role="alert" data-testid="disk-banner">
      <Icons.HardDrive size={14} />
      <span className="offline__text">{t("storage.bannerText", { free: freeText(disk.free_bytes) })}</span>
      <Button size="sm" variant="secondary" onClick={() => go.config("storage")}>
        {t("storage.bannerCta")}
      </Button>
      <IconButton
        size="sm"
        label={t("common.close")}
        icon={<Icons.X size={14} />}
        onClick={() => closeCard({ disk: true })}
      />
    </div>
  );
}
