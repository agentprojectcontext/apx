// Placeholder for F3. The model is decided in plan/01-arquitectura-v2.md §5.
import { z } from "zod";

export const Placement = z.enum(["inline", "sidebar", "fullscreen"]);
export type Placement = z.infer<typeof Placement>;
