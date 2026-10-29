import { createContext } from "react";

/** The Flow whose editor a chat sits in: its cards there need not show it again. */
export const OpenFlow = createContext<string | undefined>(undefined);
