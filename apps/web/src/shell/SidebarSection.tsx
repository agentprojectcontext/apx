import { Icons, Popover, SectionLabel } from "@apx/ui";
import { type KeyboardEvent, type PointerEvent, type ReactNode, useRef } from "react";
import { SIDEBAR_MIN_ROWS, type SidebarRows, setSidebarRows, useSidebarRows } from "../data/prefs.ts";
import { useT } from "../i18n/index.ts";
import { SidebarTooltipButton } from "./SidebarNavRow.tsx";

export function SidebarSection({
  rail,
  title,
  action,
  folded,
  onToggle,
  unread = 0,
  unreadLabel,
}: {
  rail: boolean;
  title: string;
  action?: ReactNode;
  folded?: boolean;
  onToggle?: () => void;
  unread?: number;
  unreadLabel?: string;
}) {
  return (
    <>
      <hr className="sidebar__divider" />
      {rail ? (
        action && <div className="sidebar__railaction">{action}</div>
      ) : (
        <SectionLabel action={action}>
          {onToggle ? (
            <button
              type="button"
              className={folded ? "sidebar__toggle is-closed" : "sidebar__toggle"}
              aria-expanded={!folded}
              aria-label={folded && unread > 0 ? unreadLabel : undefined}
              onClick={onToggle}
            >
              {title}
              <Icons.ChevronDown size={12} className="sidebar__chev" />
              {folded && unread > 0 && <span className="apx-nav__count is-attention">{unread}</span>}
            </button>
          ) : (
            title
          )}
        </SectionLabel>
      )}
    </>
  );
}

export function SidebarOverflow({
  rail,
  title,
  label,
  text,
  count,
  unread = 0,
  active = false,
  open,
  onOpenChange,
  children,
}: {
  rail: boolean;
  title: string;
  label: string;
  text?: string;
  count: number;
  unread?: number;
  active?: boolean;
  open: boolean;
  onOpenChange(open: boolean): void;
  children: ReactNode;
}) {
  return (
    <Popover
      side="right"
      align="start"
      width={280}
      open={open}
      onOpenChange={onOpenChange}
      label={title}
      trigger={
        <SidebarTooltipButton
          label={label}
          className={`apx-nav sidebar__more${rail ? " apx-nav--collapsed" : ""}${active ? " is-active" : ""}`}
        >
          <span className="apx-nav__icon">
            <span className="sidebar__moretile">+{count}</span>
          </span>
          {!rail && <span className="apx-nav__label">{text ?? title}</span>}
          {!rail && unread > 0 && <span className="apx-nav__count is-attention">{unread}</span>}
          {rail && unread > 0 && <span className="apx-nav__dot" aria-hidden="true" />}
        </SidebarTooltipButton>
      }
    >
      <div className="morelist__head">{title}</div>
      <div className="morelist">{children}</div>
    </Popover>
  );
}

/** A nav row (34px) plus the gap between rows: one row of a section per step of the grip. */
const ROW_STEP = 36;

/**
 * The bottom edge of a sidebar section: drag it (or use the arrows) to show more or fewer rows, the rest folding into
 * "N more". Shown only when the section has more rows than its minimum.
 */
export function SidebarRowsGrip({
  section,
  total,
  title,
}: {
  section: keyof SidebarRows;
  total: number;
  title: string;
}) {
  const t = useT();
  const rows = useSidebarRows(section);
  const min = SIDEBAR_MIN_ROWS[section];
  const max = Math.max(min, total);
  const start = useRef<{ y: number; rows: number } | undefined>(undefined);
  if (total <= min) return null;
  const set = (n: number) => setSidebarRows(section, Math.min(max, Math.max(min, n)));
  const down = (e: PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    start.current = { y: e.clientY, rows: Math.min(rows, max) };
  };
  const move = (e: PointerEvent<HTMLDivElement>) => {
    if (start.current) set(start.current.rows + Math.round((e.clientY - start.current.y) / ROW_STEP));
  };
  const up = () => {
    start.current = undefined;
  };
  const key = (e: KeyboardEvent<HTMLDivElement>) => {
    const step = e.key === "ArrowDown" ? 1 : e.key === "ArrowUp" ? -1 : 0;
    if (!step) return;
    e.preventDefault();
    set(Math.min(rows, max) + step);
  };
  return (
    // biome-ignore lint/a11y/useSemanticElements: a separator that moves is the WAI-ARIA window splitter pattern.
    <div
      role="separator"
      aria-orientation="horizontal"
      aria-label={t("nav.rowsResize", { section: title.toLocaleLowerCase() })}
      aria-valuenow={Math.min(rows, max)}
      aria-valuemin={min}
      aria-valuemax={max}
      tabIndex={0}
      className="sidebar__grip"
      onPointerDown={down}
      onPointerMove={move}
      onPointerUp={up}
      onPointerCancel={up}
      onKeyDown={key}
      onDoubleClick={() => setSidebarRows(section, 0)}
    />
  );
}
