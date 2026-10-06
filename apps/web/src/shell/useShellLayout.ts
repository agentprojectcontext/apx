import { createContext, useContext } from "react";
import type { Layout } from "./layout.ts";

/** The shell's column widths, for the columns that resize themselves (the side panel). */
export const ShellLayout = createContext<Layout | undefined>(undefined);

export function useShellLayout(): Layout | undefined {
  return useContext(ShellLayout);
}
