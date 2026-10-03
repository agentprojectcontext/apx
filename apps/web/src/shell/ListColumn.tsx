import { ResizeHandle } from "@apx/ui";
import type { ReactNode } from "react";
import { setPrefs } from "../data/prefs.ts";
import { useT } from "../i18n/index.ts";
import { LAYOUT } from "./layout.ts";

/**
 * The chat list beside a chat (Inbox, a project's chats, an engine's sessions): narrower or wider from its edge; it
 * never folds away (a folded list showed nothing to go back to).
 */
export function ListColumn({ width, children }: { width: number; children: ReactNode }) {
  const t = useT();
  return (
    <div className="listcol">
      {children}
      <ResizeHandle
        className="listcol__resize"
        width={width}
        min={LAYOUT.listMinW}
        max={LAYOUT.listMaxW}
        onResize={(w) => setPrefs({ listW: w })}
        onReset={() => setPrefs({ listW: 0 })}
        label={t("inbox.resize")}
      />
    </div>
  );
}
