import { IconButton, Icons, Tooltip } from "@apx/ui";
import type { ReactNode } from "react";
import { formatBytes } from "../../common/format.ts";
import { coreOnThisComputer, downloadFile, type FileWhere, revealFile } from "../../data/files.ts";
import { useT } from "../../i18n/index.ts";

/** One line over the file: its path and size, whatever the view adds, then download and "Show in Finder". */
export function FileHead({
  where,
  path,
  size,
  children,
}: {
  where: FileWhere;
  path: string;
  size?: number;
  children?: ReactNode;
}) {
  const t = useT();
  return (
    <header className="files__head">
      <Tooltip content={size == null ? path : `${path} · ${formatBytes(size)}`}>
        <span className="files__path">{path}</span>
      </Tooltip>
      {size != null && <span className="files__size">{formatBytes(size)}</span>}
      <span className="files__spacer" />
      {children}
      <IconButton
        size="sm"
        label={t("files.download")}
        icon={<Icons.Download size={14} />}
        onClick={() => void downloadFile(where, path)}
      />
      {coreOnThisComputer() && (
        <IconButton
          size="sm"
          label={t("files.reveal")}
          icon={<Icons.FolderOpen size={14} />}
          onClick={() => void revealFile(where, path)}
        />
      )}
    </header>
  );
}
