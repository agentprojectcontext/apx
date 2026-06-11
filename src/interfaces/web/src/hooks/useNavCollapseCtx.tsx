import { createContext, useContext, useState, useEffect, type ReactNode } from "react";

// ── Nav collapse ─────────────────────────────────────────────────────────────

type CollapseState = { collapsed: boolean; toggle: () => void } | null;

const CollapseReadCtx = createContext<CollapseState>(null);
const CollapseSetCtx = createContext<((s: CollapseState) => void) | null>(null);

// ── Page label (extra breadcrumb segment pushed by leaf screens) ──────────────

const LabelReadCtx = createContext<string>("");
const LabelSetCtx = createContext<((s: string) => void) | null>(null);

// ── Page actions (buttons screens can inject into the TopBar) ─────────────────

const ActionsReadCtx = createContext<ReactNode>(null);
const ActionsSetCtx = createContext<((a: ReactNode) => void) | null>(null);

// ── Combined provider (one wrapper in Shell) ──────────────────────────────────

export function NavCollapseProvider({ children }: { children: ReactNode }) {
  const [collapse, setCollapse] = useState<CollapseState>(null);
  const [label, setLabel] = useState("");
  const [actions, setActions] = useState<ReactNode>(null);
  return (
    <CollapseSetCtx.Provider value={setCollapse}>
      <CollapseReadCtx.Provider value={collapse}>
        <LabelSetCtx.Provider value={setLabel}>
          <LabelReadCtx.Provider value={label}>
            <ActionsSetCtx.Provider value={setActions}>
              <ActionsReadCtx.Provider value={actions}>
                {children}
              </ActionsReadCtx.Provider>
            </ActionsSetCtx.Provider>
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

// ── Page actions hooks ────────────────────────────────────────────────────────

export function usePageActions() {
  return useContext(ActionsReadCtx);
}

export function useSetPageActions(actions: ReactNode) {
  const set = useContext(ActionsSetCtx);
  useEffect(() => {
    set?.(actions);
    return () => set?.(null);
  }, [actions, set]);
}
