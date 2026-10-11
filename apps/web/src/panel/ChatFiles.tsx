import "../styles/screens.css";
import { SegmentedControl } from "@apx/ui";
import { useState } from "react";
import { useT } from "../i18n/index.ts";
import { FilesPane } from "../project/files/FilesPane.tsx";

/** A chat's files: the folder its agent works in, or its temp folder (what the system will clear). */
export function ChatFiles({
  thread,
  root,
  label,
  stacked,
}: {
  thread: string;
  root: string | undefined;
  label: string | undefined;
  stacked: boolean;
}) {
  const t = useT();
  const [scope, setScope] = useState<"chat" | "temp">("chat");
  return (
    <div className="chatfiles">
      <div className="chatfiles__bar">
        <SegmentedControl
          size="sm"
          label={t("files.scope")}
          value={scope}
          onValueChange={(v) => setScope(v as "chat" | "temp")}
          options={[
            { value: "chat", label: t("files.scope.chat") },
            { value: "temp", label: t("files.scope.temp") },
          ]}
        />
        {scope === "temp" && <p className="chatfiles__note">{t("files.tempNote")}</p>}
      </div>
      {scope === "chat" ? (
        <FilesPane key="chat" where={{ thread }} root={root} label={label} stacked={stacked} />
      ) : (
        <FilesPane key="temp" where={{ thread, scratch: true }} label={t("files.scope.temp")} stacked={stacked} />
      )}
    </div>
  );
}
