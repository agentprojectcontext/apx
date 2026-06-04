import { createSimpleContext } from "./helper"
import { useSDK } from "./sdk-apx"

export const { use: useProject, provider: ProjectProvider } = createSimpleContext({
  name: "Project",
  init: () => {
    const sdk = useSDK()

    return {
      data: {
        project: { id: sdk.pid },
        instance: { path: { directory: process.cwd(), home: "", state: "", config: "", worktree: "" } },
        workspace: { current: undefined as string | undefined, list: [] as any[], status: {} as Record<string, any> },
      },
      project() {
        return sdk.pid
      },
      instance: {
        path() {
          return { directory: process.cwd(), worktree: "", home: "", state: "", config: "" }
        },
        directory() {
          return process.cwd()
        },
      },
      workspace: {
        current(): string | undefined {
          return undefined
        },
        set(_next?: string | null) {},
        list() {
          return [] as any[]
        },
        get(_id: string) {
          return undefined
        },
        status(_id: string): "connected" | "connecting" | "disconnected" | "error" | undefined {
          return "connected"
        },
        statuses() {
          return {} as Record<string, any>
        },
        async sync() {},
      },
      async sync() {},
    }
  },
})
