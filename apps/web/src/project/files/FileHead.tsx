import { Button, Icons } from "@apx/ui";
import type { ReactNode } from "react";
import { formatBytes } from "../../common/format.ts";
import { coreOnThisComputer, downloadFile, type FileWhere, revealFile } from "../../data/files.ts";
import { useT } from "../../i18n/index.ts";

/** The file's path and size, with "Show in Finder" and whatever the view adds. */
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
      <span className="files__path">{path}</span>
      {size != null && <span className="files__size">{formatBytes(size)}</span>}
      <span className="files__spacer" />
      {children}
      <Button
        size="sm"
        variant="ghost"
        leadingIcon={<Icons.Download size={14} />}
        onClick={() => void downloadFile(where, path)}
      >
        {t("files.download")}
      </Button>
      {coreOnThisComputer() && (
        <Button
          size="sm"
          variant="ghost"
          leadingIcon={<Icons.FolderOpen size={14} />}
          onClick={() => void revealFile(where, path)}
        >
          {t("files.reveal")}
        </Button>
      )}
    </header>
  );
}
