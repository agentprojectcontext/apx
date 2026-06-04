export * as TuiConfig from "./tui"

import { createBindingLookup } from "@opentui/keymap/extras"
import { KeymapLeaderTimeoutDefault } from "./tui-schema"
import { TuiKeybind } from "./keybind"

export type Info = {
  theme?: string
  keybinds?: TuiKeybind.KeybindOverrides
  plugin?: unknown[]
  plugin_enabled?: Record<string, boolean>
  leader_timeout?: number
  scroll_speed?: number
  scroll_acceleration?: { enabled: boolean }
  diff_style?: "auto" | "stacked"
  mouse?: boolean
}

export type Resolved = Omit<Info, "keybinds" | "leader_timeout"> & {
  keybinds: TuiKeybind.BindingLookupView
  leader_timeout: number
  plugin_origins?: unknown[]
}

function buildResolved(info: Info): Resolved {
  const keybinds = TuiKeybind.parse({ ...(info.keybinds ?? {}) })
  return {
    ...info,
    keybinds: createBindingLookup(TuiKeybind.toBindingConfig(keybinds), {
      commandMap: TuiKeybind.CommandMap,
      bindingDefaults: TuiKeybind.bindingDefaults(),
    }),
    leader_timeout: info.leader_timeout ?? KeymapLeaderTimeoutDefault,
  }
}

const _default: Resolved = buildResolved({})

/** Returns resolved TUI config. In APX mode this always returns the default config. */
export async function get(): Promise<Resolved> {
  return _default
}

export async function waitForDependencies(): Promise<void> {
  // no-op in APX mode
}
