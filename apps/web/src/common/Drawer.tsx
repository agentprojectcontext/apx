import { IconButton, Icons } from "@apx/ui";
import { type ReactNode, useEffect, useRef } from "react";
import { useT } from "../i18n/index.ts";

/** Escape inside an open menu, list or dialog closes that first; only a bare Escape closes the drawer. */
const POPUP = '[role="dialog"], [role="alertdialog"], [role="menu"], [role="listbox"]';
const OPEN_POPUP = '[role="dialog"][data-open], [role="menu"][data-open], [role="listbox"][data-open]';

/**
 * A panel over the right edge of the page: the list beside it keeps its place and width; on a narrow window it takes
 * the whole width. × or Escape closes it; `back` steps out of a nested view (a routine's run → the routine).
 */
export function Drawer(props: {
  label: string;
  title: ReactNode;
  onClose: () => void;
  back?: { label: string; onClick: () => void };
  actions?: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  const t = useT();
  const close = useRef(props.onClose);
  close.current = props.back?.onClick ?? props.onClose;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented) return;
      const target = e.target instanceof Element ? e.target : null;
      if (target?.closest(POPUP) || document.querySelector(OPEN_POPUP)) return;
      close.current();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  return (
    <aside className={props.className ? `drawer ${props.className}` : "drawer"} aria-label={props.label}>
      <header className="drawer__head">
        {props.back && (
          <IconButton
            size="sm"
            label={props.back.label}
            icon={<Icons.ArrowLeft size={14} />}
            onClick={props.back.onClick}
          />
        )}
        <h2 className="drawer__title">{props.title}</h2>
        {props.actions}
        <IconButton size="sm" label={t("common.close")} icon={<Icons.X size={14} />} onClick={props.onClose} />
      </header>
      {props.children}
    </aside>
  );
}
