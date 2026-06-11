/**
 * APX session sidebar.
 *
 * A self-contained panel tailored to APX data (session title, agent, model,
 * token usage / cost, working directory). OpenCode-style Context block shows
 * tokens, % of the window used, and spend.
 */
import { createMemo, Show } from "solid-js"
import { useTheme } from "@tui/context/theme"
import { useApxSync } from "@tui/context/sync-apx"
import { useSDK } from "@tui/context/sdk-apx"
import { useLocal } from "@tui/context/local"
import pkg from "../../../../../package.json"

// Rough default context window for the % gauge when the model is unknown.
const DEFAULT_WINDOW = 200_000

function titlecase(value: string) {
  return value.charAt(0).toUpperCase() + value.slice(1)
}

function fmt(n: number): string {
  return n.toLocaleString("en-US")
}

function Section(props: { title: string; children: any }) {
  const { theme } = useTheme()
  return (
    <box flexDirection="column" marginBottom={1}>
      <text color={theme.textMuted}>{props.title}</text>
      {props.children}
    </box>
  )
}

export function SidebarApx(props: { sessionID: string }) {
  const { theme } = useTheme()
  const sync = useApxSync()
  const sdk = useSDK()
  const local = useLocal()

  const title = createMemo(() => sync.session.title(props.sessionID))
  const usage = createMemo(() => sync.session.usage(props.sessionID))
  const messages = createMemo(() => sync.session.messages(props.sessionID))
  const msgCount = createMemo(() => messages().filter((m) => m.role === "user" || m.role === "assistant").length)

  // Prefer the live model the user picked via /models; fall back to launch arg.
  const modelLabel = createMemo(() => {
    const parsed = local.model?.parsed?.()
    if (parsed?.modelID) return parsed.providerID ? `${parsed.providerID}:${parsed.modelID}` : parsed.modelID
    return sdk.model || "—"
  })

  const totalTokens = createMemo(() => usage().input + usage().output)
  const pctUsed = createMemo(() => Math.min(99, Math.round((usage().input / DEFAULT_WINDOW) * 100)))

  // Directory shown as a muted parent path + a bold basename (OpenCode style).
  const dirBase = createMemo(() => {
    const segs = (sdk.directory || "").split("/").filter(Boolean)
    return segs.length ? segs[segs.length - 1] : sdk.directory || "—"
  })
  const dirParent = createMemo(() => {
    const dir = sdk.directory || ""
    const base = dirBase()
    return dir.endsWith("/" + base) ? dir.slice(0, dir.length - base.length) : ""
  })

  return (
    <box
      flexDirection="column"
      width={34}
      flexShrink={0}
      borderLeft={1}
      borderColor={theme.border}
      paddingLeft={2}
      paddingRight={1}
      paddingTop={1}
    >
      <Section title="Session">
        <text color={theme.text} wrap>
          {title() || (props.sessionID ? "New session" : "—")}
        </text>
      </Section>

      <Section title="Agent">
        <text color={theme.text}>{titlecase(sdk.agent || "APX")}</text>
      </Section>

      <Section title="Model">
        <text color={theme.text}>{modelLabel()}</text>
        <text color={theme.textMuted}>ctrl+p → switch model</text>
      </Section>

      <Section title="Context">
        <Show
          when={totalTokens() > 0}
          fallback={<text color={theme.textMuted}>{msgCount()} messages</text>}
        >
          <text color={theme.text}>
            {fmt(totalTokens())} tokens · {pctUsed()}% used
          </text>
          <text color={theme.textMuted}>
            {fmt(usage().input)} in · {fmt(usage().output)} out
          </text>
          <Show when={usage().cost > 0}>
            <text color={theme.textMuted}>${usage().cost.toFixed(4)} spent</text>
          </Show>
          <text color={theme.textMuted}>{msgCount()} messages</text>
        </Show>
      </Section>

      {/* spacer pushes the directory + version to the bottom, OpenCode-style */}
      <box flexGrow={1} />

      <Section title="Directory">
        <Show when={dirParent()}>
          <text color={theme.textMuted} wrap>
            {dirParent()}
          </text>
        </Show>
        {/* folder name + branch in white; the path above stays muted/grey */}
        <box flexDirection="row" flexWrap="wrap">
          <text color={theme.text}>{dirBase()}</text>
          <Show when={sdk.branch}>
            <text color={theme.text}>:{sdk.branch}</text>
          </Show>
        </box>
      </Section>

      <box flexDirection="row">
        <text color={theme.success}>•</text>
        <text color={theme.textMuted}> APX {pkg.version}</text>
      </box>
    </box>
  )
}
