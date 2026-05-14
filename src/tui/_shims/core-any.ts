// Catch-all shim for any unmapped @opencode-ai/core/* imports
import os from "os"
import path from "path"
export default {}
const _apxStateDir = path.join(os.homedir(), ".apx", "tui-state")
export const Global: any = {
  Path: {
    state: _apxStateDir,
    config: path.join(os.homedir(), ".apx"),
    data: _apxStateDir,
    cache: path.join(os.homedir(), ".apx", "cache"),
  },
}
export const AppFileSystem: any = {}
export const Flock: any = {}
export const Glob: any = {}
export const Npm: any = {}
export const Observability: any = {}
export const PositiveInt: any = {}
export const InstallationVersion: any = {}
export const InstallationChannel: any = {}
export const InstallationLocal: any = {}
export const makeRuntime: any = () => ({})
export const ensureProcessMetadata: any = () => {}
export type DeepMutable<T> = T
export const Schema: any = {}
export const Context: any = {}
export const Effect: any = {}
export const Fiber: any = {}
export const Layer: any = {}
