// The settings stored as JSON, each with its schema and the value it has when unset or unreadable. They are read
// only through `store.settings.read`, so a bad stored value falls back here instead of reaching the code using it.
import { ImageDefaults, MemorySettings, ModelChoice, NoticePrefs, RouterConfig, TaskColumn } from "@apx/protocol";
import { z } from "zod";
import { DEFAULT_COLUMNS } from "./tasks.ts";

export type Entry<T> = { schema: z.ZodType<T>; fallback: T };
const entry = <T>(schema: z.ZodType<T>, fallback: NoInfer<T>): Entry<T> => ({ schema, fallback });

/** Names turned off per project id ("*" = everywhere); a project's list may hold the "no globals" marker. */
const OffLists = z.record(z.string(), z.array(z.string()));

export const SETTINGS = {
  task_columns: entry(z.array(TaskColumn).min(1), DEFAULT_COLUMNS),
  notices: entry(NoticePrefs, NoticePrefs.parse({})),
  /** The quick chat's shortcut and start at login; each field falls back on its own. */
  desktop: entry(z.object({ shortcut: z.string().catch("Alt+Space"), launch_at_login: z.boolean().catch(false) }), {
    shortcut: "Alt+Space",
    launch_at_login: false,
  }),
  /** Saved without the auxiliary model, which keeps its own key ("model_aux", plain text). */
  memory: entry(MemorySettings.omit({ aux_model: true }).partial(), {}),
  skills_off: entry(OffLists, {}),
  mcp_off: entry(OffLists, {}),
  model_default: entry(ModelChoice.nullable(), null),
  model_router: entry(RouterConfig, { rules: [], chain: [] }),
  image_defaults: entry(ImageDefaults.partial(), {}),
};

export type SettingKey = keyof typeof SETTINGS;
export type SettingValue<K extends SettingKey> = (typeof SETTINGS)[K]["fallback"];
