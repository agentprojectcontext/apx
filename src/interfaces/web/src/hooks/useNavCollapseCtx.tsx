import { createContext, useContext, useState, useEffect, type ReactNode } from "react";

type CollapseState = { collapsed: boolean; toggle: () => void } | null;

const ReadCtx = createContext<CollapseState>(null);
const SetCtx = createContext<((s: CollapseState) => void) | null>(null);

export function NavCollapseProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<CollapseState>(null);
  return (
    <SetCtx.Provider value={setState}>
      <ReadCtx.Provider value={state}>
        {children}
      </ReadCtx.Provider>
    </SetCtx.Provider>
  );
}

export function useNavCollapseCtx() {
  return useContext(ReadCtx);
}

export function useRegisterNavCollapse(collapsed: boolean, toggle: () => void) {
  const setState = useContext(SetCtx);
  useEffect(() => {
    setState?.({ collapsed, toggle });
    return () => setState?.(null);
  }, [collapsed, toggle, setState]);
}
