import { type CSSProperties, createContext, type ReactNode, type RefObject, useContext, useRef } from "react";
import { cx } from "../cx";

export type ApxLook = "minimal" | "classic";
export type ApxMode = "light" | "dark";

type ApxContextValue = { look: ApxLook; mode: ApxMode; portalRef: RefObject<HTMLDivElement | null> };
const ApxContext = createContext<ApxContextValue | null>(null);

export interface ApxProviderProps {
  /** Visual language. "minimal" = v2 (warm greys, ink accent, pills). "classic" = APX v1 (green selection, mono meta, 12px radius). */
  look?: ApxLook;
  /** Color mode. Every look has a light and a dark value set. */
  mode?: ApxMode;
  /** Paint the page background (`--apx-bg`) and fill the parent's height. Use on the app root. */
  fill?: boolean;
  className?: string;
  style?: CSSProperties;
  children?: ReactNode;
}

/**
 * Root of every APX surface. Sets the look and mode (as `data-apx-look` / `data-apx-mode`),
 * which switches every `--apx-*` token underneath, and hosts the portal layer that menus,
 * tooltips and dialogs render into so overlays keep the same look. Nest a second provider
 * to show one region in another look or mode.
 */
export function ApxProvider({
  look = "minimal",
  mode = "light",
  fill = false,
  className,
  style,
  children,
}: ApxProviderProps) {
  const portalRef = useRef<HTMLDivElement | null>(null);
  return (
    <ApxContext.Provider value={{ look, mode, portalRef }}>
      <div className={cx("apx", fill && "apx-fill", className)} data-apx-look={look} data-apx-mode={mode} style={style}>
        {children}
        <div ref={portalRef} className="apx-portal" />
      </div>
    </ApxContext.Provider>
  );
}

/** Current look/mode, and the portal container overlays should mount into. Works outside a provider (minimal · light). */
export function useApx(): ApxContextValue {
  const ctx = useContext(ApxContext);
  const fallback = useRef<HTMLDivElement | null>(null);
  return ctx ?? { look: "minimal", mode: "light", portalRef: fallback };
}
