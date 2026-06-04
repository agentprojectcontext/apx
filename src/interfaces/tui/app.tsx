import { render, TimeToFirstDraw, useRenderer, useTerminalDimensions } from "@opentui/solid"
import { createDefaultOpenTuiKeymap } from "@opentui/keymap/opentui"
import * as Clipboard from "@tui/util/clipboard"
import * as Selection from "@tui/util/selection"
import { createCliRenderer, MouseButton, type CliRendererConfig } from "@opentui/core"
import { RouteProvider, useRoute } from "@tui/context/route"
import {
  Switch,
  Match,
  createEffect,
  createMemo,
  ErrorBoundary,
  createSignal,
  onMount,
  onCleanup,
  batch,
  Show,
  on,
} from "solid-js"
import { win32DisableProcessedInput, win32InstallCtrlCGuard } from "./win32"
import { Flag } from "@opencode-ai/core/flag/flag"
import { DialogProvider, useDialog } from "@tui/ui/dialog"
import { ErrorComponent } from "@tui/component/error-component"
import { PluginRouteMissing } from "@tui/component/plugin-route-missing"
import { ProjectProvider } from "@tui/context/project-apx"
import { EditorContextProvider } from "@tui/context/editor"
import { useEvent } from "@tui/context/event-apx"
import { SDKProvider, useSDK } from "@tui/context/sdk-apx"
import { StartupLoading } from "@tui/component/startup-loading"
import { ApxSyncProvider, useApxSync } from "@tui/context/sync-apx"
import { SyncProvider } from "@tui/context/sync"
import { LocalProvider, useLocal } from "@tui/context/local"
import { DialogModel } from "@tui/component/dialog-model"
import { useConnected } from "@tui/component/use-connected"
import { DialogMcp } from "@tui/component/dialog-mcp"
import { DialogStatus } from "@tui/component/dialog-status"
import { DialogThemeList } from "@tui/component/dialog-theme-list"
import { DialogHelp } from "./ui/dialog-help"
import { DialogAgent } from "@tui/component/dialog-agent"
import { DialogSessionList } from "@tui/component/dialog-session-list"
import { ThemeProvider, useTheme } from "@tui/context/theme"
import { Home } from "@tui/routes/home"
import { Session } from "@tui/routes/session"
import { PromptHistoryProvider } from "./component/prompt/history"
import { FrecencyProvider } from "./component/prompt/frecency"
import { PromptStashProvider } from "./component/prompt/stash"
import { DialogAlert } from "./ui/dialog-alert"
import { ToastProvider, useToast } from "./ui/toast"
import { ExitProvider, useExit } from "./context/exit"
import { TuiEvent } from "./event"
import { KVProvider, useKV } from "./context/kv"
import { ArgsProvider, useArgs, type Args } from "./context/args"
import { PromptRefProvider, usePromptRef } from "./context/prompt"
import { TuiConfigProvider, useTuiConfig } from "./context/tui-config"
import type { TuiConfig } from "@/cli/cmd/tui/config/tui"
import { TuiPluginRuntime } from "@/cli/cmd/tui/plugin/runtime"
import { createTuiApi } from "@/cli/cmd/tui/plugin/api"
import type { RouteMap } from "@/cli/cmd/tui/plugin/api"
import { FormatError, FormatUnknownError } from "@/cli/error"
import { CommandPaletteProvider, useCommandPalette } from "./context/command-palette"
import { OpencodeKeymapProvider, registerOpencodeKeymap, useBindings, useOpencodeKeymap } from "./keymap"
import { DialogVariant } from "./component/dialog-variant"

const appBindingCommands = [
  "command.palette.show",
  "session.list",
  "session.new",
  "session.cycle_recent",
  "session.cycle_recent_reverse",
  "session.quick_switch.1",
  "session.quick_switch.2",
  "session.quick_switch.3",
  "session.quick_switch.4",
  "session.quick_switch.5",
  "session.quick_switch.6",
  "session.quick_switch.7",
  "session.quick_switch.8",
  "session.quick_switch.9",
  "model.list",
  "model.cycle_recent",
  "model.cycle_recent_reverse",
  "model.cycle_favorite",
  "model.cycle_favorite_reverse",
  "agent.list",
  "mcp.list",
  "agent.cycle",
  "agent.cycle.reverse",
  "variant.cycle",
  "variant.list",
  "opencode.status",
  "theme.switch",
  "theme.switch_mode",
  "theme.mode.lock",
  "help.show",
  "docs.open",
  "app.debug",
  "app.console",
  "app.heap_snapshot",
  "terminal.suspend",
  "terminal.title.toggle",
  "app.toggle.animations",
  "app.toggle.file_context",
  "app.toggle.diffwrap",
  "app.toggle.paste_summary",
  "app.toggle.session_directory_filter",
] as const

function rendererConfig(_config: TuiConfig.Resolved): CliRendererConfig {
  const mouseEnabled = !Flag.OPENCODE_DISABLE_MOUSE && (_config.mouse ?? true)

  return {
    externalOutputMode: "passthrough",
    targetFps: 60,
    gatherStats: false,
    exitOnCtrlC: false,
    useKittyKeyboard: {},
    autoFocus: false,
    openConsoleOnError: false,
    useMouse: mouseEnabled,
    consoleOptions: {
      keyBindings: [{ name: "y", ctrl: true, action: "copy-selection" }],
      onCopySelection: (text) => {
        Clipboard.copy(text).catch((error) => {
          console.error(`Failed to copy console selection to clipboard: ${error}`)
        })
      },
    },
  }
}

function errorMessage(error: unknown) {
  const formatted = FormatError(error)
  if (formatted !== undefined) return formatted
  if (
    typeof error === "object" &&
    error !== null &&
    "data" in error &&
    typeof (error as any).data === "object" &&
    (error as any).data !== null &&
    "message" in (error as any).data &&
    typeof (error as any).data.message === "string"
  ) {
    return (error as any).data.message
  }
  return FormatUnknownError(error)
}

export function tui(input: {
  url: string
  pid: string
  agent?: string
  model?: string
  args: Args
  config: TuiConfig.Resolved
  onSnapshot?: () => Promise<string[]>
  directory?: string
  fetch?: typeof fetch
  headers?: RequestInit["headers"]
  events?: unknown
}) {
  // promise to prevent immediate exit
  // oxlint-disable-next-line no-async-promise-executor -- intentional: async executor used for sequential setup before resolve
  return new Promise<void>(async (resolve) => {
    const unguard = win32InstallCtrlCGuard()
    win32DisableProcessedInput()

    const onExit = async () => {
      unguard?.()
      resolve()
    }

    const onBeforeExit = async () => {
      offKeymap()
      await TuiPluginRuntime.dispose()
    }

    const renderer = await createCliRenderer(rendererConfig(input.config))
    // Prewarm palette before ThemeProvider mounts so `system` theme avoids a first-paint fallback flash.
    void renderer.getPalette({ size: 16 }).catch(() => undefined)
    const mode = (await renderer.waitForThemeMode(1000)) ?? "dark"

    const keymap = createDefaultOpenTuiKeymap(renderer)
    const offKeymap = registerOpencodeKeymap(keymap, renderer, input.config)

    await render(() => {
      return (
        <ErrorBoundary
          fallback={(error, reset) => (
            <ErrorComponent error={error} reset={reset} onBeforeExit={onBeforeExit} onExit={onExit} mode={mode} />
          )}
        >
          <OpencodeKeymapProvider keymap={keymap}>
            <ArgsProvider {...input.args}>
              <ExitProvider onBeforeExit={onBeforeExit} onExit={onExit}>
                <KVProvider>
                  <ToastProvider>
                    <RouteProvider
                      initialRoute={
                        input.args.continue
                          ? {
                              type: "session",
                              sessionID: "dummy",
                            }
                          : undefined
                      }
                    >
                      <TuiConfigProvider config={input.config}>
                        <SDKProvider
                          url={input.url}
                          pid={input.pid}
                          agent={input.agent}
                          model={input.model}
                          directory={input.directory}
                          fetch={input.fetch}
                          headers={input.headers}
                          events={input.events}
                        >
                          <ProjectProvider>
                            <ApxSyncProvider>
                              <SyncProvider>
                              <ThemeProvider mode={mode}>
                                <LocalProvider>
                                  <PromptStashProvider>
                                    <DialogProvider>
                                      <CommandPaletteProvider>
                                        <FrecencyProvider>
                                          <PromptHistoryProvider>
                                            <PromptRefProvider>
                                              <EditorContextProvider>
                                                <App onSnapshot={input.onSnapshot} />
                                              </EditorContextProvider>
                                            </PromptRefProvider>
                                          </PromptHistoryProvider>
                                        </FrecencyProvider>
                                      </CommandPaletteProvider>
                                    </DialogProvider>
                                  </PromptStashProvider>
                                </LocalProvider>
                              </ThemeProvider>
                              </SyncProvider>
                            </ApxSyncProvider>
                          </ProjectProvider>
                        </SDKProvider>
                      </TuiConfigProvider>
                    </RouteProvider>
                  </ToastProvider>
                </KVProvider>
              </ExitProvider>
            </ArgsProvider>
          </OpencodeKeymapProvider>
        </ErrorBoundary>
      )
    }, renderer)
  })
}

function App(props: { onSnapshot?: () => Promise<string[]> }) {
  const tuiConfig = useTuiConfig()
  const route = useRoute()
  const dimensions = useTerminalDimensions()
  const renderer = useRenderer()
  const dialog = useDialog()
  const local = useLocal()
  const kv = useKV()
  const command = useCommandPalette()
  const keymap = useOpencodeKeymap()
  const event = useEvent()
  const sdk = useSDK()
  const toast = useToast()
  const themeState = useTheme()
  const { theme, mode, setMode, locked, lock, unlock } = themeState
  const sync = useApxSync()
  const exit = useExit()
  const promptRef = usePromptRef()
  const routes: RouteMap = new Map()
  const [routeRev, setRouteRev] = createSignal(0)
  const routeView = (name: string) => {
    routeRev()
    return routes.get(name)?.at(-1)?.render
  }

  const api = createTuiApi({
    tuiConfig,
    dialog,
    keymap,
    kv,
    route,
    routes,
    bump: () => setRouteRev((x) => x + 1),
    event,
    sdk,
    sync,
    theme: themeState,
    toast,
    renderer,
  })
  const [ready, setReady] = createSignal(false)
  TuiPluginRuntime.init({
    api,
    config: tuiConfig,
  })
    .catch((error: unknown) => {
      console.error("Failed to load TUI plugins", error)
    })
    .finally(() => {
      setReady(true)
    })

  // Let selection copy/dismiss win ahead of normal bindings when the feature flag is on.
  const offSelectionKeys = keymap.intercept(
    "key",
    ({ event }: { event: any }) => {
      if (!Flag.OPENCODE_EXPERIMENTAL_DISABLE_COPY_ON_SELECT) return
      Selection.handleSelectionKey(renderer, toast, event)
    },
    { priority: 1 },
  )
  onCleanup(offSelectionKeys)

  // Wire up console copy-to-clipboard via opentui's onCopySelection callback
  renderer.console.onCopySelection = async (text: string) => {
    if (!text || text.length === 0) return

    await Clipboard.copy(text)
      .then(() => toast.show({ message: "Copied to clipboard", variant: "info" }))
      .catch(toast.error)

    renderer.clearSelection()
  }
  const [terminalTitleEnabled, setTerminalTitleEnabled] = createSignal(kv.get("terminal_title_enabled", true))
  const [pasteSummaryEnabled, setPasteSummaryEnabled] = createSignal(kv.get("paste_summary_enabled", true))

  // Update terminal window title based on current route and session
  createEffect(() => {
    if (!terminalTitleEnabled() || Flag.OPENCODE_DISABLE_TERMINAL_TITLE) return

    if (route.data.type === "home") {
      renderer.setTerminalTitle("APX")
      return
    }

    if (route.data.type === "session") {
      const session = sync.session.get(route.data.sessionID)
      if (!session || !session.title || session.title === "New session") {
        renderer.setTerminalTitle("APX")
        return
      }

      const title = session.title.length > 40 ? session.title.slice(0, 37) + "..." : session.title
      renderer.setTerminalTitle(`APX | ${title}`)
      return
    }

    if (route.data.type === "plugin") {
      renderer.setTerminalTitle(`APX | ${route.data.id}`)
    }
  })

  const args = useArgs()
  onMount(() => {
    batch(() => {
      if (args.agent) local.agent.set(args.agent)
      if (args.model) {
        // APX uses simple model strings — just set it directly via local store
        // The model is already configured in the SDK; just navigate if needed
      }
      if (args.sessionID && !args.fork) {
        route.navigate({
          type: "session",
          sessionID: args.sessionID,
        })
      }
    })
  })

  const connected = useConnected()
  const appCommands = createMemo(() =>
    [
      {
        name: "command.palette.show",
        title: "Show command palette",
        category: "System",
        hidden: true,
        run: () => {
          command.show()
        },
      },
      {
        name: "session.list",
        title: "Switch session",
        category: "Session",
        suggested: sync.session.list().length > 0,
        slashName: "sessions",
        slashAliases: ["resume", "continue"],
        run: () => {
          dialog.replace(() => <DialogSessionList />)
        },
      },
      {
        name: "session.new",
        title: "New session",
        suggested: route.data.type === "session",
        category: "Session",
        slashName: "new",
        slashAliases: ["clear"],
        run: () => {
          route.navigate({
            type: "home",
          })
          dialog.clear()
        },
      },
      {
        name: "model.list",
        title: "Switch model",
        suggested: true,
        category: "Agent",
        slashName: "models",
        run: () => {
          dialog.replace(() => <DialogModel />)
        },
      },
      {
        name: "model.cycle_recent",
        title: "Model cycle",
        category: "Agent",
        hidden: true,
        run: () => {
          local.model.cycle(1)
        },
      },
      {
        name: "model.cycle_recent_reverse",
        title: "Model cycle reverse",
        category: "Agent",
        hidden: true,
        run: () => {
          local.model.cycle(-1)
        },
      },
      {
        name: "model.cycle_favorite",
        title: "Favorite cycle",
        category: "Agent",
        hidden: true,
        run: () => {
          local.model.cycleFavorite(1)
        },
      },
      {
        name: "model.cycle_favorite_reverse",
        title: "Favorite cycle reverse",
        category: "Agent",
        hidden: true,
        run: () => {
          local.model.cycleFavorite(-1)
        },
      },
      {
        name: "agent.list",
        title: "Switch agent",
        category: "Agent",
        slashName: "agents",
        run: () => {
          dialog.replace(() => <DialogAgent />)
        },
      },
      {
        name: "mcp.list",
        title: "Toggle MCPs",
        category: "Agent",
        slashName: "mcps",
        run: () => {
          dialog.replace(() => <DialogMcp />)
        },
      },
      {
        name: "agent.cycle",
        title: "Agent cycle",
        category: "Agent",
        hidden: true,
        run: () => {
          local.agent.move(1)
        },
      },
      {
        name: "variant.cycle",
        title: "Variant cycle",
        category: "Agent",
        run: () => {
          local.model.variant.cycle()
        },
      },
      {
        name: "variant.list",
        title: "Switch model variant",
        category: "Agent",
        hidden: local.model.variant.list().length === 0,
        slashName: "variants",
        run: () => {
          dialog.replace(() => <DialogVariant />)
        },
      },
      {
        name: "agent.cycle.reverse",
        title: "Agent cycle reverse",
        category: "Agent",
        hidden: true,
        run: () => {
          local.agent.move(-1)
        },
      },
      {
        name: "opencode.status",
        title: "View status",
        slashName: "status",
        run: () => {
          dialog.replace(() => <DialogStatus />)
        },
        category: "System",
      },
      {
        name: "theme.switch",
        title: "Switch theme",
        slashName: "themes",
        run: () => {
          dialog.replace(() => <DialogThemeList />)
        },
        category: "System",
      },
      {
        name: "theme.switch_mode",
        title: mode() === "dark" ? "Switch to light mode" : "Switch to dark mode",
        run: () => {
          setMode(mode() === "dark" ? "light" : "dark")
          dialog.clear()
        },
        category: "System",
      },
      {
        name: "theme.mode.lock",
        title: locked() ? "Unlock theme mode" : "Lock theme mode",
        run: () => {
          if (locked()) unlock()
          else lock()
          dialog.clear()
        },
        category: "System",
      },
      {
        name: "help.show",
        title: "Help",
        slashName: "help",
        run: () => {
          dialog.replace(() => <DialogHelp />)
        },
        category: "System",
      },
      {
        name: "app.exit",
        title: "Exit the app",
        slashName: "exit",
        slashAliases: ["quit", "q"],
        run: () => exit(),
        category: "System",
      },
      {
        name: "app.debug",
        title: "Toggle debug panel",
        category: "System",
        run: () => {
          renderer.toggleDebugOverlay()
          dialog.clear()
        },
      },
      {
        name: "app.console",
        title: "Toggle console",
        category: "System",
        run: () => {
          renderer.console.toggle()
          dialog.clear()
        },
      },
      {
        name: "app.heap_snapshot",
        title: "Write heap snapshot",
        category: "System",
        run: async () => {
          const files = await props.onSnapshot?.()
          toast.show({
            variant: "info",
            message: `Heap snapshot written to ${files?.join(", ")}`,
            duration: 5000,
          })
          dialog.clear()
        },
      },
      {
        name: "terminal.suspend",
        title: "Suspend terminal",
        category: "System",
        hidden: true,
        enabled: process.platform !== "win32",
        run: () => {
          process.once("SIGCONT", () => {
            renderer.resume()
          })

          renderer.suspend()
          process.kill(0, "SIGTSTP")
        },
      },
      {
        name: "terminal.title.toggle",
        title: terminalTitleEnabled() ? "Disable terminal title" : "Enable terminal title",
        category: "System",
        run: () => {
          setTerminalTitleEnabled((prev) => {
            const next = !prev
            kv.set("terminal_title_enabled", next)
            if (!next) renderer.setTerminalTitle("")
            return next
          })
          dialog.clear()
        },
      },
      {
        name: "app.toggle.animations",
        title: kv.get("animations_enabled", true) ? "Disable animations" : "Enable animations",
        category: "System",
        run: () => {
          kv.set("animations_enabled", !kv.get("animations_enabled", true))
          dialog.clear()
        },
      },
      {
        name: "app.toggle.file_context",
        title: kv.get("file_context_enabled", false) ? "Disable file context" : "Enable file context",
        category: "System",
        run: () => {
          kv.set("file_context_enabled", !kv.get("file_context_enabled", false))
          dialog.clear()
        },
      },
      {
        name: "app.toggle.diffwrap",
        title: kv.get("diff_wrap_mode", "word") === "word" ? "Disable diff wrapping" : "Enable diff wrapping",
        category: "System",
        run: () => {
          const current = kv.get("diff_wrap_mode", "word")
          kv.set("diff_wrap_mode", current === "word" ? "none" : "word")
          dialog.clear()
        },
      },
      {
        name: "app.toggle.paste_summary",
        title: pasteSummaryEnabled() ? "Disable paste summary" : "Enable paste summary",
        category: "System",
        run: () => {
          setPasteSummaryEnabled((prev) => {
            const next = !prev
            kv.set("paste_summary_enabled", next)
            return next
          })
          dialog.clear()
        },
      },
      {
        name: "app.toggle.session_directory_filter",
        title: kv.get("session_directory_filter_enabled", true)
          ? "Disable session directory filtering"
          : "Enable session directory filtering",
        category: "System",
        run: async () => {
          kv.set("session_directory_filter_enabled", !kv.get("session_directory_filter_enabled", true))
          await sync.session.refresh()
          dialog.clear()
        },
      },
    ].map((command) => ({
      namespace: "palette",
      ...command,
    })),
  )

  useBindings(() => ({
    commands: appCommands(),
  }))

  useBindings(() => ({
    enabled: command.matcher,
    bindings: tuiConfig.keybinds.gather(
      "app",
      Flag.OPENCODE_EXPERIMENTAL_SESSION_SWITCHING
        ? appBindingCommands
        : appBindingCommands.filter(
            (c) => !c.startsWith("session.cycle_recent") && !c.startsWith("session.quick_switch"),
          ),
    ),
  }))

  useBindings(() => ({
    enabled: () => {
      const ok = command.matcher.get()
      if (!ok) return false
      const current = promptRef.current
      if (!current?.focused) return true
      return current.current.input === ""
    },
    bindings: tuiConfig.keybinds.gather("app_exit", ["app.exit"]),
  }))

  event.on(TuiEvent.CommandExecute.type as any, (evt: any) => {
    command.run(evt.properties.command)
  })

  event.on(TuiEvent.ToastShow.type as any, (evt: any) => {
    toast.show({
      title: evt.properties.title,
      message: evt.properties.message,
      variant: evt.properties.variant,
      duration: evt.properties.duration,
    })
  })

  event.on(TuiEvent.SessionSelect.type as any, (evt: any) => {
    route.navigate({
      type: "session",
      sessionID: evt.properties.sessionID,
    })
  })

  const plugin = createMemo(() => {
    if (!ready()) return
    if (route.data.type !== "plugin") return
    const render = routeView(route.data.id)
    if (!render) return <PluginRouteMissing id={route.data.id} onHome={() => route.navigate({ type: "home" })} />
    return render({ params: route.data.data })
  })

  return (
    <box
      width={dimensions().width}
      height={dimensions().height}
      flexDirection="column"
      backgroundColor={theme.background}
      onMouseDown={(evt: any) => {
        if (!Flag.OPENCODE_EXPERIMENTAL_DISABLE_COPY_ON_SELECT) return
        if (evt.button !== MouseButton.RIGHT) return

        if (!Selection.copy(renderer, toast)) return
        evt.preventDefault()
        evt.stopPropagation()
      }}
      onMouseUp={
        Flag.OPENCODE_EXPERIMENTAL_DISABLE_COPY_ON_SELECT ? undefined : () => Selection.copy(renderer, toast)
      }
    >
      <Show when={Flag.OPENCODE_SHOW_TTFD}>
        <TimeToFirstDraw />
      </Show>
      <Show when={ready()}>
        <box flexGrow={1} minHeight={0} flexDirection="column">
          <Switch>
            <Match when={route.data.type === "home"}>
              <Home />
            </Match>
            <Match when={route.data.type === "session"}>
              <Session />
            </Match>
          </Switch>
          {plugin()}
        </box>
        <box flexShrink={0}>
          <TuiPluginRuntime.Slot name="app_bottom" />
        </box>
        <TuiPluginRuntime.Slot name="app" />
      </Show>
      <StartupLoading ready={ready} />
    </box>
  )
}
