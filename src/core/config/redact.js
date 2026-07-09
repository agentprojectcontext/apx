// Secret redaction for the global config. Wraps any string secret with a
// `*** set *** (...<suffix>)` marker so the web admin can show "value is set"
// without leaking it, AND so PATCH callers can echo back the marker to mean
// "don't touch this one" — see isSecretMarker / mergeRedactedChannels below.
//
// The dotted paths in SECRET_PATHS are the single source of truth for "which
// keys are secrets". Anything new (a new engine api_key, a new TTS provider
// key, etc.) goes here and every redaction path picks it up.

const SECRET_MARKER_PREFIX = "*** set ***";

export const SECRET_PATHS = [
  "engines.anthropic.api_key",
  "engines.openai.api_key",
  "engines.groq.api_key",
  "engines.openrouter.api_key",
  "engines.gemini.api_key",
  "voice.tts.elevenlabs.api_key",
  "voice.tts.openai.api_key",
  "voice.tts.gemini.api_key",
  "transcription.openai.api_key",
  "transcription.custom.api_key",
  "memory.embeddings.openai.api_key",
  "memory.embeddings.gemini.api_key",
  // Telegram bot tokens live inside an array — handled separately in redact()
  // because dotted paths can't address array entries.
  "telegram.channels.*.bot_token",
];

/** Replace a secret string with the visible marker, preserving the last 5 chars. */
export function secretMarker(value) {
  if (typeof value !== "string" || !value.length) return value;
  const suffix = value.slice(-5);
  return `${SECRET_MARKER_PREFIX} (...${suffix})`;
}

/** True when a value is the placeholder a redacted view sends back unchanged. */
export function isSecretMarker(value) {
  return typeof value === "string" && value.startsWith(SECRET_MARKER_PREFIX);
}

/** Deep-copy of `cfg` with every secret string replaced by its marker. */
export function redactConfig(cfg) {
  const out = JSON.parse(JSON.stringify(cfg || {}));
  const mark = (val) => (typeof val === "string" && val.length ? secretMarker(val) : val);

  for (const dotted of SECRET_PATHS) {
    if (dotted.includes("*")) continue;
    const parts = dotted.split(".");
    let cur = out;
    for (let i = 0; i < parts.length - 1; i++) {
      if (!cur[parts[i]] || typeof cur[parts[i]] !== "object") { cur = null; break; }
      cur = cur[parts[i]];
    }
    if (cur && cur[parts[parts.length - 1]]) {
      cur[parts[parts.length - 1]] = mark(cur[parts[parts.length - 1]]);
    }
  }
  const channels = out?.telegram?.channels;
  if (Array.isArray(channels)) {
    for (const ch of channels) {
      if (ch && typeof ch.bot_token === "string" && ch.bot_token.length) {
        ch.bot_token = mark(ch.bot_token);
      }
    }
  }
  return out;
}

/** Walk a dotted path on an object, returning the value or undefined. */
function getDotted(obj, dotted) {
  let cur = obj;
  for (const part of dotted.split(".")) {
    if (!cur || typeof cur !== "object") return undefined;
    cur = cur[part];
  }
  return cur;
}

/** Set a dotted path on an object, creating intermediate objects. */
function setDotted(obj, dotted, value) {
  const parts = dotted.split(".");
  let cur = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    if (!cur[parts[i]] || typeof cur[parts[i]] !== "object") cur[parts[i]] = {};
    cur = cur[parts[i]];
  }
  cur[parts[parts.length - 1]] = value;
}

/**
 * Merge a possibly-redacted config `next` against the prior on-disk config.
 * Anywhere a secret path in `next` holds a marker (the value a redacted view
 * echoes back), restore the prior real secret — so saving the redacted view
 * never clobbers a real key with the literal "*** set ***" string. Mutates and
 * returns `next`.
 */
export function mergeRedactedSecrets(next, prior) {
  if (!next || typeof next !== "object") return next;
  for (const dotted of SECRET_PATHS) {
    if (dotted.includes("*")) continue;
    if (isSecretMarker(getDotted(next, dotted))) {
      const priorVal = getDotted(prior, dotted);
      if (typeof priorVal === "string" && priorVal.length) setDotted(next, dotted, priorVal);
    }
  }
  const nextChannels = next?.telegram?.channels;
  if (Array.isArray(nextChannels)) {
    next.telegram.channels = mergeRedactedChannels(nextChannels, prior?.telegram?.channels);
  }
  return next;
}

/** Redact a single Telegram channel record. */
export function redactChannel(channel) {
  if (!channel?.bot_token) return channel;
  return { ...channel, bot_token: secretMarker(channel.bot_token) };
}

/**
 * Merge a PATCH-shape `nextChannels` against the prior on-disk list. Any
 * incoming channel whose bot_token is missing or a marker takes the prior
 * token verbatim — so a UI that echoes the redacted view back doesn't wipe
 * the real secret.
 */
export function mergeRedactedChannels(nextChannels, priorChannels) {
  if (!Array.isArray(nextChannels)) return nextChannels;
  const priorByName = new Map(
    (Array.isArray(priorChannels) ? priorChannels : [])
      .filter((c) => c && typeof c.name === "string")
      .map((c) => [c.name, c])
  );
  return nextChannels.map((channel) => {
    if (!channel || typeof channel !== "object") return channel;
    const prior = priorByName.get(channel.name);
    if (prior?.bot_token && (channel.bot_token === undefined || isSecretMarker(channel.bot_token))) {
      return { ...channel, bot_token: prior.bot_token };
    }
    return channel;
  });
}
