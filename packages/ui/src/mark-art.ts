import { createElement, type ReactNode } from "react";
import type { MarkArt, MarkNode } from "./channel-marks";

/** A whole mark's elements, `{id}` in their attributes made one icon's own (`prefix`). */
export function drawMarkArt(mark: MarkArt, prefix: string): ReactNode {
  return mark.art.map((n, i) => drawn(n, prefix, i));
}

function drawn(n: MarkNode, prefix: string, key: number): ReactNode {
  const props: Record<string, unknown> = { key };
  for (const [k, v] of Object.entries(n.a)) {
    const value = v.replaceAll("{id}", prefix);
    // A style is written as CSS ("mask-type:alpha"); React takes it as an object.
    props[k] =
      k === "style"
        ? Object.fromEntries(
            value
              .split(";")
              .filter(Boolean)
              .map((d) => {
                const [prop = "", val = ""] = d.split(":");
                return [prop.trim().replace(/-([a-z])/g, (_m, c: string) => c.toUpperCase()), val.trim()];
              }),
          )
        : value;
  }
  return createElement(n.t, props, ...(n.c ?? []).map((c, i) => drawn(c, prefix, i)));
}
