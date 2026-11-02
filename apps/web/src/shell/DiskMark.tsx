import { IconButton, Icons } from "@apx/ui";
import { useClosedCards } from "../data/cornerCards.ts";
import { diskWarning } from "../data/diskModel.ts";
import { freeText, useDiskStatus } from "../data/storage.ts";
import { useT } from "../i18n/index.ts";
import { go } from "./nav.ts";

/** The low-disk warning once its card or strip is closed: a disk in the sidebar foot while space stays short. */
export function DiskMark({ rail }: { rail: boolean }) {
  const t = useT();
  const disk = useDiskStatus();
  const closed = useClosedCards((s) => s.disk);
  if (!disk || diskWarning(disk, closed) !== "mark") return null;
  return (
    <IconButton
      className="diskmark"
      size="lg"
      mark="warning"
      label={t("storage.bannerText", { free: freeText(disk.free_bytes) })}
      tooltipSide={rail ? "right" : "top"}
      icon={<Icons.HardDrive />}
      onClick={() => go.config("storage")}
      data-testid="disk-mark"
    />
  );
}
