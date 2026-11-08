import { Button, IconButton, Icons, PickRow, type PickRowProps, Tooltip } from "@apx/ui";
import type { ReactNode } from "react";
import { useT } from "../i18n/index.ts";

/** The value of the list chip: what a tool shows when no opened item is in front. */
export const LIST_TAB = "list";

/** One opened item: a document, a sub-chat, a terminal, a browser tab. */
type PanelTab = {
  id: string;
  label: string;
  /** Before the label, when a dot does not say enough (a terminal, a screen). */
  icon?: ReactNode;
  /** Who holds it or whether it runs: busy/agent (warning), handoff (pulsing), user (brand), idle (subtle). */
  dot?: "busy" | "agent" | "handoff" | "user" | "idle";
  /** Shown after the label, quieter ("ended"). */
  note?: string;
  /** Opened items close by default; a tab that is not the owner's to close says so. */
  closable?: boolean;
};

export type PanelTabsProps = {
  /** Names the strip for screen readers (the tool's name). */
  label: string;
  /** The list chip ("All (3)"); a tool without a list (the browser) leaves it out. */
  list?: string | undefined;
  tabs: readonly PanelTab[];
  /** LIST_TAB or an opened item's id; anything else selects nothing (a new tab being typed). */
  value: string | undefined;
  onSelect(id: string): void;
  onClose?(id: string): void;
  /** A trailing "+" (a new browser tab, a new terminal). */
  onNew?: (() => void) | undefined;
  newLabel?: string;
  /** Right-aligned controls of the list itself (a scope picker). */
  trailing?: ReactNode;
};

/**
 * The strip under every side-panel tool's header: first the list ("All (N)"), then each opened item as a tab that
 * closes. One strip for every tool, so they all read the same.
 */
export function PanelTabs({ label, list, tabs, value, onSelect, onClose, onNew, newLabel, trailing }: PanelTabsProps) {
  const t = useT();
  return (
    <div className="ptabs">
      <div className="ptabs__strip" role="tablist" aria-label={label}>
        {list !== undefined && (
          <Tab
            label={list}
            icon={<Icons.List size={12} />}
            on={value === LIST_TAB}
            onSelect={() => onSelect(LIST_TAB)}
          />
        )}
        {tabs.map((tab) => (
          <Tab
            key={tab.id}
            label={tab.label}
            icon={tab.dot ? <span className={`ptabs__dot is-${tab.dot}`} aria-hidden="true" /> : tab.icon}
            note={tab.note}
            on={value === tab.id}
            onSelect={() => onSelect(tab.id)}
            onClose={onClose && tab.closable !== false ? () => onClose(tab.id) : undefined}
            closeLabel={t("panelTabs.close", { name: tab.label })}
          />
        ))}
        {onNew && newLabel && (
          <IconButton
            size="sm"
            className="ptabs__new"
            label={newLabel}
            icon={<Icons.Plus size={14} />}
            onClick={onNew}
          />
        )}
      </div>
      {trailing && <div className="ptabs__trail">{trailing}</div>}
    </div>
  );
}

function Tab({
  label,
  icon,
  note,
  on,
  onSelect,
  onClose,
  closeLabel,
}: {
  label: string;
  icon?: ReactNode;
  note?: string | undefined;
  on: boolean;
  onSelect(): void;
  onClose?: (() => void) | undefined;
  closeLabel?: string;
}) {
  return (
    <span className={`ptabs__tab${on ? " is-on" : ""}${onClose ? " has-close" : ""}`}>
      <Tooltip content={label} side="bottom">
        <Button
          variant="ghost"
          size="sm"
          role="tab"
          aria-selected={on}
          className="ptabs__pick"
          leadingIcon={icon}
          onClick={onSelect}
        >
          {label}
          {note && <span className="ptabs__note"> {note}</span>}
        </Button>
      </Tooltip>
      {onClose && closeLabel && (
        <IconButton
          size="sm"
          className="ptabs__close"
          label={closeLabel}
          icon={<Icons.X size={12} />}
          onClick={(e) => {
            e.stopPropagation();
            onClose();
          }}
        />
      )}
    </span>
  );
}

/** A tool's list (what the "All" chip shows): grouped rows that open an item as a tab. */
export function PanelList({ label, children }: { label: string; children: ReactNode }) {
  return (
    <section className="plist" aria-label={label}>
      {children}
    </section>
  );
}

/** A group heading inside a PanelList ("Active (1)"). */
export function PanelGroup({ title }: { title: string }) {
  return <h3 className="plist__group">{title}</h3>;
}

/** One row of a PanelList: icon or avatar, title, a line under it and what is on its right. */
export function PanelRow(props: PickRowProps) {
  return <PickRow {...props} className={props.className ? `plist__row ${props.className}` : "plist__row"} />;
}
