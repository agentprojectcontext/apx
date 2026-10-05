type Point = { x: number; y: number };
type Bounds = Point & { width: number; height: number };

/** All coordinates use Electron's screen DIP space, including displays left of or above the primary. */
export function quickPlacement(area: Bounds, size: { width: number; height: number }, anchor?: Point): Bounds {
  const margin = 8;
  const width = Math.min(size.width, Math.max(1, area.width - margin * 2));
  const height = Math.min(size.height, Math.max(1, area.height - margin * 2));
  let x = (anchor?.x ?? area.x + area.width / 2) - width / 2;
  let y = area.y + margin;
  if (anchor) {
    const edges = [
      Math.abs(anchor.y - area.y),
      Math.abs(anchor.y - (area.y + area.height)),
      Math.abs(anchor.x - area.x),
      Math.abs(anchor.x - (area.x + area.width)),
    ];
    const edge = edges.indexOf(Math.min(...edges));
    if (edge === 1) y = area.y + area.height - height - margin;
    else if (edge === 2 || edge === 3) {
      x = edge === 2 ? area.x + margin : area.x + area.width - width - margin;
      y = anchor.y - height / 2;
    }
  }
  return {
    x: Math.round(Math.min(Math.max(x, area.x + margin), area.x + area.width - width - margin)),
    y: Math.round(Math.min(Math.max(y, area.y + margin), area.y + area.height - height - margin)),
    width,
    height,
  };
}
