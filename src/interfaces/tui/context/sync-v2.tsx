/**
 * APX compatibility shim for sync-v2.tsx.
 * The original file tracked opencode-specific V2 session messages.
 * For APX we don't need it — provide a no-op provider.
 */
import { createContext, useContext, type ParentProps } from "solid-js"

const ctx = createContext<Record<string, never>>({})

export function SyncProviderV2(props: ParentProps) {
  return <ctx.Provider value={{}}>{props.children}</ctx.Provider>
}

export function useSyncV2() {
  return useContext(ctx)
}
