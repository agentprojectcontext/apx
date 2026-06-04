/**
 * APX compatibility shim for the opencode Event context.
 * Re-exports from event-apx.ts so all existing `import { useEvent } from "@tui/context/event"`
 * imports continue to work.
 */
export { useEvent } from "./event-apx"
