/** One mark and the space after it, in px (RoutineChat.css). */
const SLOT = 7;
/** Room for the "N earlier" / "N later" marks at the ends. */
const ENDS = 2 * 26;

/** Which runs fit on a rail `height` px tall: all of them, or a window around the open one. */
export function railWindow(total: number, active: number, height: number): { from: number; to: number } {
  const fits = Math.max(1, Math.floor(height / SLOT));
  if (total <= fits) return { from: 0, to: total };
  const room = Math.max(1, Math.floor((height - ENDS) / SLOT));
  const from = Math.min(Math.max(0, active - Math.floor(room / 2)), total - room);
  return { from, to: from + room };
}
