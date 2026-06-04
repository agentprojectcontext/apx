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
      <Section title="Sesión">
        <text color={theme.text} wrap>
          {title() || (props.sessionID ? "Nueva sesión" : "—")}
        </text>
      </Section>

      <Section title="Agente">
        <text color={theme.text}>{titlecase(sdk.agent || "APX")}</text>
      </Section>

      <Section title="Modelo">
        <text color={theme.text}>{modelLabel()}</text>
        <text color={theme.textMuted}>ctrl+p → Switch model</text>
      </Section>

      <Section title="Contexto">
        <Show
          when={totalTokens() > 0}
          fallback={<text color={theme.textMuted}>{msgCount()} mensajes</text>}
        >
          <text color={theme.text}>
            {fmt(totalTokens())} tokens · {pctUsed()}% usado
          </text>
          <text color={theme.textMuted}>
            {fmt(usage().input)} in · {fmt(usage().output)} out
          </text>
          <Show when={usage().cost > 0}>
            <text color={theme.textMuted}>${usage().cost.toFixed(4)} gastado</text>
          </Show>
          <text color={theme.textMuted}>{msgCount()} mensajes</text>
        </Show>
      </Section>

      <Section title="Directorio">
        <text color={theme.text} wrap>
          {sdk.directory}
        </text>
      </Section>

      <box flexGrow={1} />
      <box flexDirection="row">
        <text color={theme.success}>•</text>
        <text color={theme.textMuted}> APX {pkg.version}</text>
      </box>
    </box>
  )
}
