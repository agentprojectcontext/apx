// The settings stored as JSON, each with its schema and the value it has when unset or unreadable. They are read
// only through `store.settings.read`, so a bad stored value falls back here instead of reaching the code using it.
import {
  ChannelInfo,
  ImageDefaults,
  MemorySettings,
  ModelChoice,
  NoticePrefs,
  ProviderInfo,
  RouterConfig,
  ServiceSettings,
  TaskColumn,
} from "@apx/protocol";
import { z } from "zod";
import { DEFAULT_COLUMNS } from "./tasks.ts";

export type Entry<T> = { schema: z.ZodType<T>; fallback: T };
const entry = <T>(schema: z.ZodType<T>, fallback: NoInfer<T>): Entry<T> => ({ schema, fallback });

/** A list whose items are checked one by one: an item that does not fit is dropped, not the whole list. */
const listOf = <T>(item: z.ZodType<T>) =>
  z.array(z.unknown()).transform((items) =>
    items.flatMap((x) => {
      const r = item.safeParse(x);
      return r.success ? [r.data] : [];
    }),
  );

/** Names turned off per project id ("*" = everywhere); a project's list may hold the "no globals" marker. */
const OffLists = z.record(z.string(), z.array(z.string()));

/** A model API as the owner set it; `removed` hides a built-in one. */
const Provider = z.object({
  id: z.string().regex(/^[a-z0-9][a-z0-9-]{0,31}$/),
  transport: ProviderInfo.shape.transport,
  base_url: z.string(),
  key: z.string(),
  models: z.array(z.string()),
  label: z.string().optional(),
  preset: z.string().optional(),
  enabled: z.boolean().optional(),
  removed: z.boolean().optional(),
});

/** An ACP CLI the owner added beside the known ones. */
const AcpAgent = z.object({
  id: z.string().regex(/^[a-z0-9][a-z0-9-]*$/),
  label: z.string().optional(),
  command: z.string().min(1),
  args: z.array(z.string()),
  auth: z.string().optional(),
  env: z.record(z.string(), z.string()).optional(),
});

/** A channel as configured; how it is doing and its token are not stored here. */
const Channel = ChannelInfo.omit({ token_set: true, token_hint: true, status: true, error: true, account: true });

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
  providers: entry(listOf(Provider), []),
  acp_agents: entry(listOf(AcpAgent), []),
  /** The owner's media services, in the order they are tried. */
  services: entry(listOf(ServiceSettings.extend({ id: z.string() })), []),
  channels: entry(listOf(Channel), []),
};

export type SettingKey = keyof typeof SETTINGS;
export type SettingValue<K extends SettingKey> = (typeof SETTINGS)[K]["fallback"];
