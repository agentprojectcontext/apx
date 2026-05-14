// Catch-all shim for any unmapped @/* opencode imports.
// This file is intentionally vague — it re-exports common shapes that are
// referenced across the TUI codebase so that Bun can at least resolve them
// without hard errors.

export default {}

// Common named exports used across TUI files
export const Flag: Record<string, boolean> = new Proxy({} as Record<string, boolean>, { get: () => false })
import os from "os"
import path from "path"
const _apxStateDir = path.join(os.homedir(), ".apx", "tui-state")
export const Global: any = {
  Path: {
    state: _apxStateDir,
    config: path.join(os.homedir(), ".apx"),
    data: _apxStateDir,
    cache: path.join(os.homedir(), ".apx", "cache"),
  },
}
export const Binary: any = { search: () => ({ found: false, index: 0 }) }
export const Filesystem: any = { relative: (_: string, to: string) => to, contains: () => false }
export const Locale: any = { format: String, number: String, titlecase: (s: string) => s, truncateMiddle: (s: string) => s }
export const Provider: any = { parseModel: (m: string) => ({ providerID: null, modelID: m }) }
export const Session: any = { isDefaultTitle: () => true }
export const SessionRetry: any = {}
export const MessageID: any = { ascending: () => `msg-${Date.now()}` }
export const PartID: any = { ascending: () => `part-${Date.now()}` }
export const SessionID: any = { ascending: () => `sid-${Date.now()}` }
export const TuiConfig: any = {}
export const TuiPluginRuntime: any = {
  init: async () => {},
  dispose: async () => {},
  Slot: () => null,
}
export const createTuiApi: any = () => ({})
export const RouteMap: any = Map
export const UI: any = {}
export const iife: any = (fn: () => any) => fn()
export const emptyConsoleState: any = { switchableOrgCount: 0 }
export const FormatError: any = () => undefined
export const FormatUnknownError: any = (e: unknown) => String(e)
export const LANGUAGE_EXTENSIONS: any = {}
export const ShellTool: any = {}
export const ShellID: any = { fromString: () => null }
export const TodoWriteTool: any = {}
export const webSearchProviderLabel: any = () => ""

export function formatDuration(seconds: number): string {
  if (seconds <= 0) return ""
  if (seconds < 60) return `${seconds}s`
  return `${Math.floor(seconds / 60)}m ${seconds % 60}s`
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export function errorData(_error: unknown): undefined {
  return undefined
}

export function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v)
}

export function defer<T>(fn: () => T): T {
  return fn()
}

export const which: any = async () => undefined

export const Process: any = {}
export const Rpc: any = {}
export const AppRuntime: any = {}
export const InstanceRuntime: any = {}
export const BusEvent: any = {}
export const GlobalBus: any = {}
export const Config: any = {}
export const ConfigParse: any = {}
export const ConfigPlugin: any = {}
export const ConfigVariable: any = {}
export const ConfigPaths: any = {}
export const InvalidError: any = class {}
export const Installation: any = {}
export const PluginLoader: any = {}
export const PluginMeta: any = {}
export const Reference: any = { resolveAll: () => [] }
export const Server: any = {}
export const ServerAuth: any = {}
export const WithInstance: any = {}
export const Heap: any = {}
export const Npm: any = {}
export const upgrade: any = () => {}
export const cmd: any = {}
export const withTimeout: any = (fn: any) => fn
export const withNetworkOptions: any = () => {}
export const resolveNetworkOptionsNoConfig: any = () => ({})
export const displayCharAt: any = () => ""
export const mentionTriggerIndex: any = () => -1
export const installPlugin: any = () => {}
export const patchPluginConfig: any = () => {}
export const readPluginManifest: any = () => ({})
export const installModulePlugin: any = () => {}
export const readPackageThemes: any = () => []
export const readPluginId: any = () => undefined
export const readV1Plugin: any = () => undefined
export const resolvePluginId: any = () => undefined
export type PluginPackage = any
export type PluginSource = any
export const disposeAllInstancesAndEmitGlobalDisposed: any = () => {}

// Types (as `any`)
export type DeepMutable<T> = T
export type Tool = any
export type TuiPlugin = any
export type TuiPluginApi = any
export type TuiPluginStatus = any
export type TuiPluginModule = any
export type TuiCommand = any
export type TuiDialogSelectOption = any
export type TuiRouteDefinition = any
export type TuiSlotProps = any
export type TuiSlotContext = any
export type TuiSlotMap = any
export type TuiThemeCurrent = any
export type ConsoleState = { switchableOrgCount: number; activeOrgName?: string }
export type Snapshot = any
export type RouteMap = any
export type AppFileSystem = any
export type AgentPart = any
export type VcsFileStatus = any
export type ExperimentalConsoleListOrgsResponse = any
export type ProviderAuthAuthorization = any
export type QuestionAnswer = any
