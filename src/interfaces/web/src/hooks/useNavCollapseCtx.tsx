import { createContext, useContext, useState, useEffect, type ReactNode } from "react";

// ── Nav collapse ─────────────────────────────────────────────────────────────

type CollapseState = { collapsed: boolean; toggle: () => void } | null;

const CollapseReadCtx = createContext<CollapseState>(null);
const CollapseSetCtx = createContext<((s: CollapseState) => void) | null>(null);

// ── Page label (extra breadcrumb segment pushed by leaf screens) ──────────────

const LabelReadCtx = createContext<string>("");
const LabelSetCtx = createContext<((s: string) => void) | null>(null);

// ── Combined provider (one wrapper in Shell) ──────────────────────────────────

export function NavCollapseProvider({ children }: { children: ReactNode }) {
  const [collapse, setCollapse] = useState<CollapseState>(null);
  const [label, setLabel] = useState("");
  return (
    <CollapseSetCtx.Provider value={setCollapse}>
      <CollapseReadCtx.Provider value={collapse}>
        <LabelSetCtx.Provider value={setLabel}>
          <LabelReadCtx.Provider value={label}>
            {children}
          </LabelReadCtx.Provider>
        </LabelSetCtx.Provider>
      </CollapseReadCtx.Provider>
    </CollapseSetCtx.Provider>
  );
}

// ── Nav collapse hooks ────────────────────────────────────────────────────────

export function useNavCollapseCtx() {
  return useContext(CollapseReadCtx);
}

export function useRegisterNavCollapse(collapsed: boolean, toggle: () => void) {
  const setState = useContext(CollapseSetCtx);
  useEffect(() => {
    setState?.({ collapsed, toggle });
    return () => setState?.(null);
  }, [collapsed, toggle, setState]);
}

// ── Page label hooks ──────────────────────────────────────────────────────────

export function usePageLabel() {
  return useContext(LabelReadCtx);
}

export function useSetPageLabel(label: string) {
  const set = useContext(LabelSetCtx);
  useEffect(() => {
    set?.(label);
    return () => set?.("");
  }, [label, set]);
}
