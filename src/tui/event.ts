/**
 * APX replacement for the opencode TuiEvent definitions.
 * Uses simple string constants instead of the effect BusEvent system.
 */

// Simple event type descriptor that provides `.type` like BusEvent
function defineEvent(type: string) {
  return { type } as const
}

export const TuiEvent = {
  PromptAppend: defineEvent("tui.prompt.append"),
  CommandExecute: defineEvent("tui.command.execute"),
  ToastShow: defineEvent("tui.toast.show"),
  SessionSelect: defineEvent("tui.session.select"),
}
