import type { ReactElement, ReactNode } from "react";
import { Tooltip, TooltipContent, TooltipTrigger } from "./tooltip";

/** Thin convenience wrapper around the shadcn tooltip: <Tip content="…"><button/></Tip>. */
export function Tip({
  content,
  side = "top",
  children,
}: {
  content: ReactNode;
  side?: "top" | "right" | "bottom" | "left";
  children: ReactElement;
}) {
  if (!content) return children;
  return (
    <Tooltip>
      <TooltipTrigger render={children} />
      <TooltipContent side={side}>{content}</TooltipContent>
    </Tooltip>
  );
}
