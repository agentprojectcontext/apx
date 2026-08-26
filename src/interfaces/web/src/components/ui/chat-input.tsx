"use client"

import * as React from "react"
import { ArrowUp, Plus, Square } from "lucide-react"

import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Tip } from "./tip"
import { t } from "@/i18n"

/** What a caller-supplied attach menu can do to the hidden file input. */
export interface FilePicker {
  open: (accept?: string) => void
}

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
  /** Full-bleed strip welded to the top edge of the card — the conversation's
   *  context summary. It cancels the card padding itself, so it reads as the
   *  field's own top edge rather than as a separate bar hovering above it. */
  header?: React.ReactNode
  /** Handle onto the hidden file input, so a caller-supplied menu can open it
   *  with its own `accept` filter. */
  pickerRef?: React.Ref<FilePicker>
  /** Replaces the default "+" button on the action row. Pass a menu when there
   *  is more than one way to attach (photo, file, camera). */
  leading?: React.ReactNode
  /** Sits between the footer and send: the mic, on surfaces that record. */
  trailing?: React.ReactNode
  /** Send with no text. An attachment on its own is a turn — the daemon builds
   *  the marker that stands in for the words. */
  allowEmpty?: boolean
  /** Extra key handling (e.g. ↑/↓/Enter for an @mention picker). Return true
   *  to consume the event so Enter does not also send. */
  onKeyDown?: (e: React.KeyboardEvent<HTMLTextAreaElement>) => boolean | void
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
  maxRows = 12,
  footer,
  onFiles,
  accept,
  above,
  header,
  pickerRef,
  leading,
  trailing,
  allowEmpty = false,
  onKeyDown,
  className,
}: ChatInputProps) {
  const ref = React.useRef<HTMLTextAreaElement>(null)
  const fileRef = React.useRef<HTMLInputElement>(null)
  React.useImperativeHandle(pickerRef, () => ({
    open: (override?: string) => {
      const el = fileRef.current
      if (!el) return
      // The menu picks the filter per entry ("photo or video" vs "file"); it is
      // restored right after so the next open is not stuck on the last choice.
      if (override !== undefined) el.setAttribute("accept", override)
      el.click()
      if (override !== undefined) setTimeout(() => el.setAttribute("accept", accept || ""), 0)
    },
  }))
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
      // Two ceilings, and the lower one wins: maxRows for the shape of the
      // field, and 40% of the window so a long draft on a phone can never grow
      // over the conversation it is about. Without the second one, maxRows big
      // enough to be comfortable on a desktop swallows a 812px screen.
      const max = Math.min(lineHeight * maxRows, Math.round(window.innerHeight * 0.4))
      el.style.height = `${Math.min(Math.max(el.scrollHeight, min), max)}px`
      el.style.overflowY = el.scrollHeight > max ? "auto" : "hidden"
    }
    resize()
    // Re-run after the next paint to catch cases where the parent layout
    // wasn't ready on the initial sync pass (e.g. inside a resizable panel
    // that's just been mounted).
    const raf = requestAnimationFrame(resize)
    // The viewport ceiling above moves: rotating the phone, or the on-screen
    // keyboard opening, changes what 40% is.
    window.addEventListener("resize", resize)
    return () => {
      cancelAnimationFrame(raf)
      window.removeEventListener("resize", resize)
    }
  }, [value, minRows, maxRows])

  // Note what this does NOT read: `busy`. A draft in the field is a turn to
  // send, and the agent already working is no reason to refuse it — the caller
  // queues it onto the thread. Being busy only decides what the button becomes
  // once there is nothing left to send.
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
      {header}
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
          if (onKeyDown?.(e)) return
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault()
            if (!canSend) return
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
                multiple
                className="hidden"
                onChange={(e) => {
                  takeFiles(e.target.files)
                  e.target.value = "" // so picking the same file twice fires again
                }}
              />
              {/* A caller with more than one way to attach supplies its own
                  trigger (a menu); everything else keeps the plain button. */}
              {leading ?? (
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
              )}
            </>
          )}
          {footer}
        </div>
        <div className="flex shrink-0 items-center gap-1">
        {trailing}
        {/* Stop is what the button becomes when the field is EMPTY. With a
            draft in it, the only thing that button can mean is "send this" —
            swapping it for a stop the moment the agent starts working turned
            every message typed mid-run into a killed run. */}
        {busy && onStop && !canSend ? (
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
    </div>
  )
}
