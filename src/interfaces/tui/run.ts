/**
 * APX TUI entry point.
 * Usage: bun --preload @opentui/solid/preload src/tui/run.ts --pid <projectId> [--agent <name>] [--model <model>]
 */
import { tui } from "./app.tsx"
import type { TuiConfig } from "./config/tui.ts"

// ─── CLI argument parsing ────────────────────────────────────────────────────
const args = process.argv.slice(2)
function getFlag(flag: string): string | undefined {
  const i = args.indexOf(flag)
  return i !== -1 ? args[i + 1] : undefined
}
function hasFlag(flag: string): boolean {
  return args.includes(flag)
}

const pid = getFlag("--pid") ?? ""
const agent = getFlag("--agent")
const model = getFlag("--model")
const cwd = getFlag("--cwd")
const promptText = getFlag("--prompt")
const sessionID = getFlag("--session")
const continueSession = hasFlag("--continue") || hasFlag("-c")

if (!pid) {
  process.stderr.write("APX TUI requires --pid <projectId>\n")
  process.exit(1)
}

const baseUrl = process.env.APX_URL ?? "http://127.0.0.1:7430"

// ─── Minimal keybind lookup (no-op bindings, defaults are loaded by opentui) ─
function createNoopKeybinds(): TuiConfig.Resolved["keybinds"] {
  return {
    get(_command: string) {
      return []
    },
    gather(_name: string, _commands: readonly string[]) {
      return []
    },
  }
}

// ─── Minimal resolved TUI config ─────────────────────────────────────────────
let config: TuiConfig.Resolved

try {
  // Attempt to load the real config (may fail if opencode-core deps missing)
  const { TuiConfig: TuiConfigModule } = await import("./config/tui.ts")
  config = await TuiConfigModule.get()
} catch {
  // Fall back to safe minimal config
  config = {
    theme: undefined,
    keybinds: createNoopKeybinds(),
    plugin: [],
    plugin_enabled: {},
    leader_timeout: 2000,
    scroll_speed: undefined,
    scroll_acceleration: undefined,
    diff_style: undefined,
    mouse: true,
    plugin_origins: [],
  } as unknown as TuiConfig.Resolved
}

// ─── Launch TUI ──────────────────────────────────────────────────────────────
await tui({
  url: baseUrl,
  pid,
  agent,
  model,
  directory: cwd,
  args: {
    prompt: promptText,
    continue: continueSession,
    sessionID,
    fork: false,
    agent,
    model,
  },
  config,
})

process.exit(0)
