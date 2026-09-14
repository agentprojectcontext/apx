import * as React from "react"

interface AutoGrowOpts {
  /** Floor, in lines. The field never draws shorter than this, empty or not. */
  minRows?: number
  /** Ceiling, in lines. Past it the field scrolls instead of growing. */
  maxRows?: number
  /** Second ceiling, as a share of the available height. The lower of the two
   *  wins, so a maxRows comfortable on a desktop can't swallow a phone. */
  viewportRatio?: number
  /** Measure that share against the scrolling box the field lives in, not the
   *  window. For a field INSIDE a list (the in-place message editor), the
   *  window is the wrong yardstick: on a tall monitor a short chat pane would
   *  still hand the editor more height than the pane has. */
  boundToScroller?: boolean
  /** Off while the field isn't mounted/visible. Listed as a dependency, so
   *  turning it back on re-measures — reopening an editor on the same text
   *  would otherwise keep whatever height the `rows` attribute gave it. */
  enabled?: boolean
}

/**
 * Grow a textarea with its content, clamped between a minimum and a maximum.
 * Shared by the composer and the in-place message editor so both fields behave
 * the same: the box is as tall as what's in it, and never shorter than minRows.
 */
export function useAutoGrow(
  ref: React.RefObject<HTMLTextAreaElement | null>,
  value: string,
  { minRows = 2, maxRows = 12, viewportRatio = 0.4, boundToScroller = false, enabled = true }: AutoGrowOpts = {},
) {
  React.useLayoutEffect(() => {
    const el = ref.current
    if (!el || !enabled) return
    const resize = () => {
      el.style.height = "auto"
      // Force a reflow before reading scrollHeight so the "auto" reset takes
      // effect — without this, scrollHeight can return the stale prior height.
      void el.offsetHeight
      const style = getComputedStyle(el)
      const lineHeight = parseFloat(style.lineHeight) || 20
      // scrollHeight includes the vertical padding, so the floor has to as
      // well — otherwise minRows lines don't fit in the minimum height.
      const chrome =
        parseFloat(style.paddingTop) + parseFloat(style.paddingBottom) +
        parseFloat(style.borderTopWidth) + parseFloat(style.borderBottomWidth)
      const min = lineHeight * minRows + chrome
      const room = boundToScroller ? Math.min(window.innerHeight, scrollerHeight(el)) : window.innerHeight
      const max = Math.max(min, Math.min(lineHeight * maxRows + chrome, Math.round(room * viewportRatio)))
      el.style.height = `${Math.min(Math.max(el.scrollHeight, min), max)}px`
      el.style.overflowY = el.scrollHeight > max ? "auto" : "hidden"
    }
    resize()
    // Re-run after the next paint to catch cases where the parent layout
    // wasn't ready on the initial sync pass (e.g. inside a resizable panel
    // that's just been mounted, or a bubble that just swapped into edit mode).
    const raf = requestAnimationFrame(resize)
    // The viewport ceiling above moves: rotating the phone, or the on-screen
    // keyboard opening, changes what the ratio is worth.
    window.addEventListener("resize", resize)
    // …and so does the element's own width: dragging the panel divider rewraps
    // the text. Only a WIDTH change re-measures — reacting to the height we
    // just set ourselves is the classic ResizeObserver feedback loop.
    let lastWidth = el.clientWidth
    const ro = typeof ResizeObserver !== "undefined"
      ? new ResizeObserver(() => {
          if (el.clientWidth === lastWidth) return
          lastWidth = el.clientWidth
          resize()
        })
      : null
    ro?.observe(el)
    return () => {
      cancelAnimationFrame(raf)
      window.removeEventListener("resize", resize)
      ro?.disconnect()
    }
  }, [ref, value, minRows, maxRows, viewportRatio, boundToScroller, enabled])
}

/** Height of the nearest scrolling ancestor, or the window's when there is
 *  none. What the field can grow into without pushing its own buttons out of
 *  sight. */
function scrollerHeight(el: HTMLElement): number {
  for (let p = el.parentElement; p; p = p.parentElement) {
    const overflow = getComputedStyle(p).overflowY
    if ((overflow === "auto" || overflow === "scroll") && p.clientHeight > 0) return p.clientHeight
  }
  return window.innerHeight
}
