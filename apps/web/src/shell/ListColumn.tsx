import { IconButton, Icons, ResizeHandle } from "@apx/ui";
import type { ReactNode } from "react";
import { setPrefs, usePrefs } from "../data/prefs.ts";
import { useT } from "../i18n/index.ts";
import { LAYOUT } from "./layout.ts";

/**
 * The chat list beside a chat (Inbox, a project's chats, an engine's sessions): resizable from its edge, or folded to
 * a strip that opens it again.
 */
export function ListColumn({ width, children }: { width: number; children: ReactNode }) {
  const t = useT();
  const folded = usePrefs((s) => s.listCollapsed);
  if (folded)
    return (
      <div className="listcol is-folded">
        <IconButton
          size="sm"
          label={t("inbox.expand")}
          icon={<Icons.PanelLeftOpen size={14} />}
          onClick={() => setPrefs({ listCollapsed: false })}
        />
      </div>
    );
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

/** The button in a list's header that folds it away. */
export function FoldList() {
  const t = useT();
  return (
    <IconButton
      label={t("inbox.collapse")}
      icon={<Icons.PanelLeftClose size={15} />}
      onClick={() => setPrefs({ listCollapsed: true })}
    />
  );
}
