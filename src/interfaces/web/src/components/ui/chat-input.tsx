"use client"

import * as React from "react"
import { ArrowUp, Plus, Square } from "lucide-react"

import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Tip } from "./tip"
import { t } from "@/i18n"

interface ChatInputProps {
  value: string
  onValueChange: (value: string) => void
  onSubmit: () => void
  onStop?: () => void
  busy?: boolean
  disabled?: boolean
  placeholder?: string
  autoFocus?: boolean
  minRows?: number
  maxRows?: number
  /** Optional content rendered on the left of the action row (e.g. a model badge or hint). */
  footer?: React.ReactNode
  /** Enables attaching: the + button, Cmd/Ctrl+V of an image, and drag-and-drop.
   *  Receives every file the user handed over, in the order they came. */
  onFiles?: (files: File[]) => void
  /** `accept` for the file picker. Only meaningful alongside onFiles. */
  accept?: string
  /** Rendered inside the field, above the textarea: the pending attachments. */
  above?: React.ReactNode
  /** Send with no text. An attachment on its own is a turn — the daemon builds
   *  the marker that stands in for the words. */
  allowEmpty?: boolean
  className?: string
}

/**
 * Composer surface for chat: an auto-growing textarea with an inline send/stop
 * button. Enter sends, Shift+Enter inserts a newline. Built on the native
 * textarea + Base UI Button — no Radix — so it slots into the design system.
 */
export function ChatInput({
  value,
  onValueChange,
  onSubmit,
  onStop,
  busy = false,
  disabled = false,
  placeholder,
  autoFocus,
  minRows = 2,
  maxRows = 8,
  footer,
  onFiles,
  accept,
  above,
  allowEmpty = false,
  className,
}: ChatInputProps) {
  const ref = React.useRef<HTMLTextAreaElement>(null)
  const fileRef = React.useRef<HTMLInputElement>(null)
  const [dropping, setDropping] = React.useState(false)

  const takeFiles = (list: FileList | null | undefined) => {
    const files = Array.from(list || [])
    if (files.length && onFiles) onFiles(files)
  }

  // Grow the textarea with its content, clamped between minRows and maxRows.
  // The min keeps a comfortable multi-line height so you can see what you're
  // typing even on a fresh, empty composer.
  React.useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const resize = () => {
      el.style.height = "auto"
      // Force a reflow before reading scrollHeight so the "auto" reset takes
      // effect — without this, scrollHeight can return the stale prior height.
      void el.offsetHeight
      const lineHeight = parseFloat(getComputedStyle(el).lineHeight) || 20
      const min = lineHeight * minRows
      const max = lineHeight * maxRows
      el.style.height = `${Math.min(Math.max(el.scrollHeight, min), max)}px`
      el.style.overflowY = el.scrollHeight > max ? "auto" : "hidden"
    }
    resize()
    // Re-run after the next paint to catch cases where the parent layout
    // wasn't ready on the initial sync pass (e.g. inside a resizable panel
    // that's just been mounted).
    const raf = requestAnimationFrame(resize)
    return () => cancelAnimationFrame(raf)
  }, [value, minRows, maxRows])

  const canSend = (value.trim().length > 0 || allowEmpty) && !disabled

  return (
    <div
      onDragOver={onFiles ? (e) => { e.preventDefault(); setDropping(true) } : undefined}
      onDragLeave={onFiles ? () => setDropping(false) : undefined}
      onDrop={onFiles ? (e) => { e.preventDefault(); setDropping(false); takeFiles(e.dataTransfer?.files) } : undefined}
      className={cn(
        // The field is a CARD, not a muted slab: on the light theme a grey fill
        // at this size reads as "disabled" — nobody types into something the
        // rest of the app uses to mean "you can't". Focus is a neutral lift, no
        // loud blue ring; a file being dragged over it is the brand green.
        "flex flex-col gap-1.5 rounded-2xl border border-border bg-card p-2 shadow-sm transition-colors",
        "focus-within:border-foreground/25",
        dropping && "border-primary/60 bg-primary/5",
        disabled && "opacity-60",
        className,
      )}
    >
      {above}
      <textarea
        ref={ref}
        rows={minRows}
        value={value}
        autoFocus={autoFocus}
        disabled={disabled}
        placeholder={placeholder}
        onChange={(e) => onValueChange(e.target.value)}
        onPaste={onFiles ? (e) => {
          // A screenshot on the clipboard arrives as a file, not as text: take
          // it and let the caption keep being typed.
          if (!e.clipboardData?.files?.length) return
          e.preventDefault()
          takeFiles(e.clipboardData.files)
        } : undefined}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault()
            if (busy || !canSend) return
            onSubmit()
          }
        }}
        className="w-full resize-none bg-transparent px-2 pt-1 text-sm leading-relaxed outline-none placeholder:text-muted-foreground"
      />
      <div className="flex items-center justify-between gap-2 pl-1">
        <div className="flex min-w-0 items-center gap-2 text-[11px] text-muted-foreground">
          {onFiles && (
            <>
              <input
                ref={fileRef}
                type="file"
                accept={accept}
                className="hidden"
                onChange={(e) => {
                  takeFiles(e.target.files)
                  e.target.value = "" // so picking the same file twice fires again
                }}
              />
              <Tip content={t("chat_ui.attach")}>
                <Button
                  type="button"
                  size="icon-sm"
                  variant="ghost"
                  disabled={disabled}
                  onClick={() => fileRef.current?.click()}
                  aria-label={t("chat_ui.attach")}
                >
                  <Plus className="size-4" />
                </Button>
              </Tip>
            </>
          )}
          {footer}
        </div>
        {busy && onStop ? (
          <Tip content={t("chat_ui.stop")}>
            <Button
              type="button"
              size="icon-sm"
              variant="destructive"
              onClick={onStop}
              aria-label={t("chat_ui.stop")}
            >
              <Square className="size-3.5" fill="currentColor" />
            </Button>
          </Tip>
        ) : (
          <Tip content={t("chat_ui.send")}>
            <Button
              type="button"
              size="icon-sm"
              variant="default"
              onClick={onSubmit}
              disabled={!canSend}
              aria-label={t("chat_ui.send")}
            >
              <ArrowUp className="size-4" />
            </Button>
          </Tip>
        )}
      </div>
    </div>
  )
}
