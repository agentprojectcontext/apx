// Shared placement types and the dependency-free kit used by every widget host.
import { z } from "zod";

export const Placement = z.enum(["inline", "sidebar", "fullscreen"]);
export type Placement = z.infer<typeof Placement>;

export { declaresApp, declaresLive, inlineKit, KIT_PATH, parseLiveDuration, usesKit } from "./kit.ts";
export {
  injectSurfaceHead,
  type SurfaceLayout,
  surfaceLayoutCss,
  WIDGET_KIT_CSS,
  WIDGET_TOKENS,
} from "./widget-kit.ts";
