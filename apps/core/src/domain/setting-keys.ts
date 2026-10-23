// The settings stored as JSON, each with its schema and the value it has when unset or unreadable. They are read
// only through `store.settings.read`, so a bad stored value falls back here instead of reaching the code using it.
import {
  ActiveProfile,
  AgentBudgets,
  AgentLimits,
  BaseProject,
  ChannelInfo,
  HookMode,
  ImageDefaults,
  MemorySettings,
  ModelChoice,
  NoticePrefs,
  Organization,
  ProviderInfo,
  RouterConfig,
  ServiceSettings,
  TaskColumn,
  TelemetryEvent,
  TelemetryStage,
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
  login: z.string().optional(),
  env: z.record(z.string(), z.string()).optional(),
});

/** A channel as configured; how it is doing and its token are not stored here. */
const Channel = ChannelInfo.omit({ token_set: true, token_hint: true, status: true, error: true, account: true });

export const SETTINGS = {
  project_helper: entry(
    z.record(
      z.string(),
      z.object({
        enabled: z.boolean().optional(),
        goal: z.string().max(2000).optional(),
        first_result: z.string().max(2000).optional(),
        dismissed: z.array(z.string().max(64)).max(100).optional(),
      }),
    ),
    {},
  ),
  task_columns: entry(z.array(TaskColumn).min(1), DEFAULT_COLUMNS),
  notices: entry(NoticePrefs, NoticePrefs.parse({})),
  /**
   * The owner's limits on agents acting on their own; a field unset keeps engine/limits.ts's default. `agents` holds
   * the budgets the owner gave single agents, inside those limits.
   */
  agent_limits: entry(AgentLimits.partial().extend({ agents: AgentBudgets.optional() }), {}),
  /** The super-agent asks before handing work to several agents in one turn (engine/fan-out.ts). */
  fan_out_ask: entry(z.boolean(), true),
  /**
   * The quick chat's shortcut, start at login (on: APX is meant to be always there) and whether agents may use this
   * computer's screen (off until the owner turns it on); each field falls back alone.
   */
  desktop: entry(
    z.object({
      shortcut: z.string().catch("Alt+Space"),
      launch_at_login: z.boolean().catch(true),
      computer_use: z.boolean().catch(false),
    }),
    { shortcut: "Alt+Space", launch_at_login: true, computer_use: false },
  ),
  /** Saved without the auxiliary model, which keeps its own key ("model_aux", plain text). */
  memory: entry(MemorySettings.omit({ aux_model: true }).partial(), {}),
  /** About the owner and their time zone (their name is the owner's person; the language is "owner_language"). */
  owner_profile: entry(z.object({ about: z.string().catch(""), timezone: z.string().catch("") }), {
    about: "",
    timezone: "",
  }),
  /** The base project's name, description and kind (it has no folder to keep them in). */
  base_project: entry(BaseProject, { name: "Default" }),
  /** The base project's areas and roles (a real project keeps them in its .apc/organization.json). */
  base_org: entry(Organization, { areas: [], roles: [] }),
  /** The profile the super-agent runs and the owner's values for it (none until the owner picks one). */
  profile: entry(ActiveProfile, { id: null, values: {} }),
  /** iMessage on this Mac as tools: off until the owner turns it on. */
  imessage: entry(z.object({ on: z.boolean().catch(false) }), { on: false }),
  skills_off: entry(OffLists, {}),
  mcp_off: entry(OffLists, {}),
  model_default: entry(ModelChoice.nullable(), null),
  model_router: entry(RouterConfig, { rules: [], chain: [] }),
  image_defaults: entry(ImageDefaults.partial(), {}),
  providers: entry(listOf(Provider), []),
  acp_agents: entry(listOf(AcpAgent), []),
  /** The owner's media services, in the order they are tried. */
  services: entry(listOf(ServiceSettings.extend({ id: z.string() })), []),
  /** Services APX added on its own once (Codex's images): one the owner removed is not added again. */
  services_offered: entry(z.array(z.string()).catch([]), []),
  channels: entry(listOf(Channel), []),
  /**
   * The public address for channels' webhooks the owner chose (webhooks.ts), applied again at every start, and the
   * last address ngrok gave (a new one is pointed out to the owner).
   */
  webhooks: entry(
    z.object({
      mode: HookMode,
      url: z.string().optional(),
      domain: z.string().optional(),
      ngrok_last: z.string().optional(),
    }),
    { mode: "off" as const },
  ),
  /**
   * Telemetry (telemetry.ts): the owner's answer on usage statistics (null: not asked yet), the lifecycle steps sent,
   * the version and answer the install's record holds, where the next usage report starts, and the last thing sent.
   */
  telemetry: entry(
    z.object({
      usage: z.boolean().nullable().catch(null),
      usage_reported: z.boolean().nullable().catch(null),
      sent: z.partialRecord(TelemetryStage, z.string()).catch({}),
      opened_at: z.string().nullable().catch(null),
      reported_version: z.string().nullable().catch(null),
      usage_from: z.string().nullable().catch(null),
      usage_day: z.string().nullable().catch(null),
      last: z.object({ at: z.string(), event: TelemetryEvent }).nullable().catch(null),
    }),
    {
      usage: null,
      usage_reported: null,
      sent: {},
      opened_at: null,
      reported_version: null,
      usage_from: null,
      usage_day: null,
      last: null,
    },
  ),
};

export type SettingKey = keyof typeof SETTINGS;
export type SettingValue<K extends SettingKey> = (typeof SETTINGS)[K]["fallback"];
