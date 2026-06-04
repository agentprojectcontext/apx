/**
 * APX compatibility shim for the opencode SDK context.
 * Re-exports from sdk-apx.tsx so existing imports continue to work.
 */
export type { ApxEvent as EventSource } from "./sdk-apx"
export { useSDK, SDKProvider } from "./sdk-apx"
