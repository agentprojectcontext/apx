/**
 * APX compatibility shim for the opencode Sync context.
 *
 * This file replaces the original opencode sync.tsx with a version that delegates
 * to the APX sync context (sync-apx.tsx) while providing the same interface shape
 * that other TUI components expect.
 */
import { createSimpleContext } from "./helper"
import { useApxSync } from "./sync-apx"
import { useArgs } from "./args"
import { onMount } from "solid-js"

// Re-export useApxSync as useSync for compatibility
export const { use: useSync, provider: SyncProvider } = createSimpleContext({
  name: "Sync",
  init: () => {
    const apx = useApxSync()
    const args = useArgs()

    onMount(() => {
      // APX sync already loads sessions in its own onMount
    })

    // APX has a single configured super-agent (passed via --agent). The opencode
    // TUI expects `data.agent` to be a non-empty list, otherwise the prompt has
    // no "current agent" and Enter silently refuses to submit.
    const apxAgent = () => ({
      name: args.agent || "apx",
      mode: "primary" as const,
      hidden: false,
      description: "APX super-agent",
    })

    // APX uses freeform model strings and resolves the model server-side from
    // the CLI `--model` arg. The opencode TUI, however, refuses to submit unless
    // `local.model.current()` resolves to a model that exists in some provider.
    // Expose a synthetic provider containing the configured model so model
    // resolution / validation passes. The values are cosmetic — the daemon
    // ignores them and uses the CLI model string directly.
    const apxModelKey = () => args.model || "apx-default"
    const apxProvider = () => ({
      id: "apx",
      // Shown as the gray label in the prompt status line: "Build · model · APX Code".
      name: "APX Code",
      models: {
        [apxModelKey()]: {
          id: apxModelKey(),
          name: apxModelKey(),
          capabilities: { reasoning: false },
        },
      },
    })

    // Return a compatible object that matches the shape expected by existing TUI components
    return {
      data: {
        get status() {
          return apx.status
        },
        // Provider fields — synthetic single provider wrapping the APX model.
        get provider() {
          return [apxProvider()] as any[]
        },
        provider_default: {} as Record<string, string>,
        provider_next: { all: [], default: {}, connected: [] } as any,
        provider_auth: {} as Record<string, any[]>,
        console_state: { switchableOrgCount: 0 } as any,
        // Agent fields — APX exposes the single configured super-agent.
        get agent() {
          return [apxAgent()] as any[]
        },
        command: [] as any[],
        // Session-related — delegate to APX
        get session() {
          return apx.session.list().map((s: any) => ({
            ...s,
            time: { updated: s.updatedAt ?? Date.now(), compacting: false },
            cost: 0,
            workspaceID: undefined,
            parentID: undefined,
          }))
        },
        session_status: {} as Record<string, any>,
        session_diff: {} as Record<string, any[]>,
        // Messages — delegate to APX
        get message() {
          return apx.data.messages as Record<string, any[]>
        },
        messages: {} as Record<string, any[]>,
        part: {} as Record<string, any[]>,
        // Permission/question stubs
        permission: {} as Record<string, any[]>,
        question: {} as Record<string, any[]>,
        todo: {} as Record<string, any[]>,
        // Config stub
        config: {
          experimental: {
            disable_paste_summary: false,
          },
          model: undefined,
          plugin: [],
          reference: [],
          share: undefined,
        } as any,
        // LSP/MCP stubs
        lsp: [] as any[],
        mcp: {} as Record<string, any>,
        mcp_resource: {} as Record<string, any>,
        formatter: [] as any[],
        vcs: undefined as any,
      },

      get status() {
        return apx.status === "ready" ? "complete" : apx.status === "loading" ? "loading" : "partial"
      },

      get ready() {
        return apx.ready
      },

      session: {
        get(sessionID: string) {
          const s = apx.session.get(sessionID)
          if (!s) return undefined
          return {
            ...s,
            time: { updated: s.updatedAt ?? Date.now(), compacting: false },
            cost: 0,
            workspaceID: undefined,
            parentID: undefined,
          }
        },
        query() {
          return {}
        },
        async refresh() {
          await apx.session.refresh()
        },
        status(_sessionID: string) {
          return "idle" as const
        },
        async sync(_sessionID: string) {},
      },

      async bootstrap() {},

      // Path info for autocomplete and other components
      path: {
        directory: process.cwd(),
        worktree: process.cwd(),
      },
    }
  },
})
