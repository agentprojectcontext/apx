/**
 * APX compatibility shim for the opencode Project context.
 *
 * Delegates to project-apx.tsx while re-exporting `useProject` and `ProjectProvider`
 * under the same names so existing imports are not broken.
 */
export { useProject, ProjectProvider } from "./project-apx"
