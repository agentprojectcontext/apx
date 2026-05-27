/**
 * APX session sidebar.
 *
 * A self-contained panel tailored to APX data (session, agent, model, token
 * usage, working directory). Replaces opencode's plugin-driven sidebar.tsx,
 * which depends on feature plugins APX does not ship.
 */
import { createMemo, Show } from "solid-js"
import { useTheme } from "@tui/context/theme"
import { useApxSync } from "@tui/context/sync-apx"
import { useSDK } from "@tui/context/sdk-apx"
import pkg from "../../../../package.json"

function titlecase(value: string) {
  if (!value) return value
  return value.charAt(0).toUpperCase() + value.slice(1)
}

function Section(props: { title: string; children: any }) {
  const { theme } = useTheme()
  return (
    <box flexDirection="column" flexShrink={0} marginBottom={1}>
      <text fg={theme.text}>
        <b>{props.title}</b>
      </text>
      {props.children}
    </box>
  )
}

export function SidebarApx(props: { sessionID: string }) {
  const { theme } = useTheme()
  const sync = useApxSync()
  const sdk = useSDK()

  const session = createMemo(() => sync.session.get(props.sessionID))
  const messages = createMemo(() => sync.session.messages(props.sessionID))
  const usage = createMemo(() => sync.data.usage)
  const totalTokens = createMemo(() => usage().input + usage().output)

  return (
    <box
      backgroundColor={theme.backgroundPanel}
      width={40}
      height="100%"
      flexShrink={0}
      flexDirection="column"
      paddingTop={1}
      paddingBottom={1}
      paddingLeft={2}
      paddingRight={2}
    >
      <box flexGrow={1} flexDirection="column">
        <Section title="Sesión">
          <text fg={theme.textMuted}>{session()?.title || "chat local"}</text>
        </Section>

        <Section title="Agente">
          <text fg={theme.textMuted}>{titlecase(sdk.agent)}</text>
        </Section>

        <Section title="Modelo">
          <text fg={theme.textMuted} wrap>
            {sdk.model}
          </text>
        </Section>

        <Section title="Contexto">
          <text fg={theme.textMuted}>{totalTokens().toLocaleString()} tokens</text>
          <text fg={theme.textMuted}>
            {usage().input.toLocaleString()} in · {usage().output.toLocaleString()} out
          </text>
          <text fg={theme.textMuted}>{messages().length} mensajes</text>
        </Section>

        <Section title="Directorio">
          <text fg={theme.textMuted} wrap>
            {process.cwd()}
          </text>
        </Section>
      </box>

      <box flexShrink={0} paddingTop={1}>
        <text fg={theme.textMuted}>
          <span style={{ fg: theme.success }}>•</span> <b>APX</b> <span>{pkg.version}</span>
        </text>
      </box>
    </box>
  )
}
