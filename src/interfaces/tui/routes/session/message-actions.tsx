/**
 * Message Actions — the contextual menu that opens when you click a message
 * bubble (OpenCode parity: Copy / Fork / Revert). Self-contained so it does not
 * depend on opencode's sync/session plugins.
 */
import { DialogSelect } from "@tui/ui/dialog-select"
import { useDialog } from "@tui/ui/dialog"
import { useToast } from "@tui/ui/toast"
import * as Clipboard from "@tui/util/clipboard"
import { useApxSync, type ApxMessage } from "@tui/context/sync-apx"

export function MessageActions(props: { sessionID: string; message: ApxMessage }) {
  const dialog = useDialog()
  const toast = useToast()
  const sync = useApxSync()

  const isQueued = props.message.queued === true
  const isUser = props.message.role === "user"

  const options = [
    ...(isQueued
      ? [{ value: "send", title: "Send now", description: "interrupt the queue and send this" }]
      : []),
    { value: "copy", title: "Copy", description: "copy message text to clipboard" },
    ...(isUser && !isQueued
      ? [{ value: "fork", title: "Fork", description: "branch a new session from here" }]
      : []),
    ...(isQueued
      ? [{ value: "remove", title: "Remove", description: "drop this queued message" }]
      : []),
  ]

  return (
    <DialogSelect
      title="Message Actions"
      options={options}
      onSelect={(option: { value: string }) => {
        dialog.clear()
        switch (option.value) {
          case "copy":
            Clipboard.copy(props.message.text)
              .then(() => toast.show({ message: "Copied to clipboard", variant: "info" }))
              .catch(() => toast.show({ message: "Copy failed", variant: "error" }))
            break
          case "send":
            void sync.sendQueued(props.sessionID, props.message.id)
            break
          case "remove":
            sync.removeMessage(props.sessionID, props.message.id)
            break
          case "fork":
            toast.show({ message: "Fork: nueva sesión desde este mensaje (próximamente)", variant: "info" })
            break
        }
      }}
    />
  )
}
