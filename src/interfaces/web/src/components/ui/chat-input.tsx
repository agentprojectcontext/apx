"use client"

import * as React from "react"
import { ArrowUp, Square } from "lucide-react"

import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
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
  className,
}: ChatInputProps) {
  const ref = React.useRef<HTMLTextAreaElement>(null)

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

  const canSend = value.trim().length > 0 && !disabled

  return (
    <div
      className={cn(
        // Surface sits a touch above the page/sheet (not the darkest token) so
        // the input reads as a distinct field; focus is a subtle neutral lift,
        // not a loud blue ring.
        "flex flex-col gap-1.5 rounded-2xl border border-border bg-muted/60 p-2 shadow-sm transition-colors",
        "focus-within:border-foreground/25 focus-within:bg-muted",
        disabled && "opacity-60",
        className,
      )}
    >
      <textarea
        ref={ref}
        rows={minRows}
        value={value}
        autoFocus={autoFocus}
        disabled={disabled}
        placeholder={placeholder}
        onChange={(e) => onValueChange(e.target.value)}
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
          {footer}
        </div>
        {busy && onStop ? (
          <Button
            type="button"
            size="icon-sm"
            variant="destructive"
            onClick={onStop}
            aria-label={t("chat_ui.stop")}
            title={t("chat_ui.stop")}
          >
            <Square className="size-3.5" fill="currentColor" />
          </Button>
        ) : (
          <Button
            type="button"
            size="icon-sm"
            variant="default"
            onClick={onSubmit}
            disabled={!canSend}
            aria-label={t("chat_ui.send")}
            title={t("chat_ui.send")}
          >
            <ArrowUp className="size-4" />
          </Button>
        )}
      </div>
    </div>
  )
}
