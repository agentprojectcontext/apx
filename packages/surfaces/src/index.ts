// Placeholder for F3: the MVP host lives in apps/web/src/surfaces.
import { z } from "zod";

export const Placement = z.enum(["inline", "sidebar", "fullscreen"]);
export type Placement = z.infer<typeof Placement>;
