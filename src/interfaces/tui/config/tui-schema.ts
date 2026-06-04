import { TuiKeybind } from "./keybind"
import { Schema } from "effect"

export const KeymapLeaderTimeoutDefault = 2000
const KeymapLeaderTimeout = Schema.Int.pipe(
  Schema.filter((n) => n > 0),
).annotations({ description: "Leader key timeout in milliseconds" })

export const ScrollSpeed = Schema.Number.pipe(
  Schema.filter((n) => n >= 0.001),
)

export const ScrollAcceleration = Schema.Struct({
  enabled: Schema.Boolean.annotations({ description: "Enable scroll acceleration" }),
}).annotations({ description: "Scroll acceleration settings" })

export const DiffStyle = Schema.Union(Schema.Literal("auto"), Schema.Literal("stacked")).annotations({
  description: "Control diff rendering style: 'auto' adapts to terminal width, 'stacked' always shows single column",
})

export const TuiInfo = Schema.Struct({
  $schema: Schema.optional(Schema.String),
  theme: Schema.optional(Schema.String),
  keybinds: Schema.optional(TuiKeybind.KeybindOverrides),
  plugin: Schema.optional(Schema.Array(Schema.Unknown)),
  plugin_enabled: Schema.optional(Schema.Record({ key: Schema.String, value: Schema.Boolean })),
  leader_timeout: Schema.optional(KeymapLeaderTimeout),
  scroll_speed: Schema.optional(ScrollSpeed).annotations({
    description: "TUI scroll speed",
  }),
  scroll_acceleration: Schema.optional(ScrollAcceleration),
  diff_style: Schema.optional(DiffStyle),
  mouse: Schema.optional(Schema.Boolean).annotations({ description: "Enable or disable mouse capture (default: true)" }),
})
