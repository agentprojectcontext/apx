// Plain values every client may need, with no zod: the browser imports these through `@apx/protocol/client`
// and never loads the schema registry (the core validates; see client.ts).

export const PROTOCOL_VERSION = 1;

export const ErrorCode = {
  BadRequest: "bad_request",
  NotFound: "not_found",
  UnknownMethod: "unknown_method",
  Unauthorized: "unauthorized",
  Unavailable: "unavailable",
  Timeout: "timeout",
  /** The user took control of the resource (e.g. a browser tab); retry later or ask. */
  PausedByUser: "paused_by_user",
  /** The action would type into a password/OTP/card field: hand off to the human. */
  CredentialField: "credential_field",
  /** The state moved on (answered already, expired): re-read before acting. */
  Conflict: "conflict",
  Internal: "internal",
} as const;
export type ErrorCode = (typeof ErrorCode)[keyof typeof ErrorCode];

/** Upload bounds: audio is transcribed, images reach vision models, and text is read inline. */
// 5 MB is the largest image every provider takes (Anthropic's limit).
export const UPLOAD_LIMITS = {
  imageBytes: 5 * 1024 * 1024,
  fileBytes: 20 * 1024 * 1024,
  audioBytes: 10 * 1024 * 1024,
  /** What someone sends on a channel (a video, a document) is kept up to this size, to play or download. */
  channelBytes: 50 * 1024 * 1024,
} as const;

/** Base64 expansion of the largest composer upload, plus room for its JSON envelope. */
export const FILE_PAYLOAD_BYTES =
  Math.ceil((Math.max(UPLOAD_LIMITS.fileBytes, UPLOAD_LIMITS.audioBytes, UPLOAD_LIMITS.imageBytes) * 4) / 3) +
  64 * 1024;

/** Maximum UTF-8 document snapshot rendered in the side panel. */
export const DOCUMENT_MAX_BYTES = 400_000;

/** How a contact relates to the owner: it shapes how the agent talks to them. */
export const PERSON_RELATIONS = [
  "partner",
  "family",
  "friend",
  "coworker",
  "client",
  "associate",
  "provider",
  "other",
] as const;

/**
 * Names picked at random: a fresh super-agent's (and the setup's dice), and the new names of cloned agents. Short,
 * easy to say in Spanish and English, none twice.
 */
export const AGENT_NAMES = [
  "Nova",
  "Milo",
  "Kira",
  "Lumo",
  "Iris",
  "Zeta",
  "Pipa",
  "Teo",
  "Luma",
  "Bruno",
  "Maya",
  "Coco",
  "Ada",
  "Alba",
  "Aldo",
  "Alma",
  "Ana",
  "Andy",
  "Ari",
  "Arlo",
  "Asha",
  "Axel",
  "Aya",
  "Beto",
  "Bea",
  "Bela",
  "Benji",
  "Blas",
  "Bo",
  "Cami",
  "Cata",
  "Cleo",
  "Coral",
  "Dani",
  "Dara",
  "Dex",
  "Dino",
  "Duna",
  "Echo",
  "Edu",
  "Eli",
  "Ema",
  "Enzo",
  "Eva",
  "Ezra",
  "Fede",
  "Felix",
  "Fina",
  "Flor",
  "Gael",
  "Gala",
  "Gia",
  "Gus",
  "Hana",
  "Hugo",
  "Ian",
  "Ike",
  "Ines",
  "Isa",
  "Ivo",
  "Jade",
  "Jana",
  "Javi",
  "Jazz",
  "Joa",
  "Jude",
  "Juno",
  "Kai",
  "Kaia",
  "Kenji",
  "Kiko",
  "Koa",
  "Lali",
  "Lara",
  "Leo",
  "Lea",
  "Lia",
  "Lino",
  "Lola",
  "Lu",
  "Luca",
  "Luz",
  "Mabel",
  "Mael",
  "Mali",
  "Mara",
  "Mateo",
  "Max",
  "Mia",
  "Mika",
  "Mila",
  "Mimi",
  "Moss",
  "Nahuel",
  "Nani",
  "Nemo",
  "Neo",
  "Nico",
  "Nilo",
  "Nina",
  "Noa",
  "Nora",
  "Olga",
  "Oli",
  "Omar",
  "Otto",
  "Paco",
  "Paz",
  "Pia",
  "Pino",
  "Quin",
  "Rafa",
  "Raia",
  "Remy",
  "Rio",
  "Rita",
  "Rocco",
  "Roma",
  "Romeo",
  "Ruby",
  "Rumi",
  "Saba",
  "Sami",
  "Sara",
  "Sol",
  "Suki",
  "Tadeo",
  "Taia",
  "Tama",
  "Tea",
  "Tina",
  "Tito",
  "Toby",
  "Tomi",
  "Uma",
  "Uri",
  "Vale",
  "Vera",
  "Vico",
  "Vida",
  "Vito",
  "Wally",
  "Wren",
  "Xena",
  "Yago",
  "Yara",
  "Yuki",
  "Yuma",
  "Zack",
  "Zara",
  "Zoe",
  "Zuri",
  "Abril",
  "Amos",
  "Anouk",
  "Bastian",
  "Bianca",
  "Ciro",
  "Dalia",
  "Elio",
  "Emil",
  "Fausto",
  "Flavia",
  "Gino",
  "Greta",
  "Ilan",
  "Indra",
  "Ivan",
  "Joel",
  "Kalu",
  "Lenny",
  "Lior",
  "Lucio",
  "Malena",
  "Marco",
  "Mora",
  "Nacho",
  "Nuria",
  "Orion",
  "Pablo",
  "Pilar",
  "Quique",
  "Reina",
  "Ruben",
  "Selma",
  "Simon",
  "Tarek",
  "Ulises",
  "Valen",
  "Wilma",
  "Yanis",
  "Zaira",
  "Zeno",
  "Alan",
  "Brisa",
  "Carmen",
  "Delfina",
  "Emma",
  "Fiona",
  "Gaspar",
  "Helga",
  "Iker",
  "Julia",
  "Kevin",
  "Lorena",
] as const;

/**
 * A name from AGENT_NAMES at random, none of `avoid` (the current one, or every name the crew already uses) while any
 * is left; past that, a name with a number ("Pia 2").
 */
export function randomAgentName(avoid: string | readonly string[] = []): string {
  const taken = new Set((typeof avoid === "string" ? [avoid] : avoid).map((n) => n.trim().toLowerCase()));
  const pool = AGENT_NAMES.filter((n) => !taken.has(n.toLowerCase()));
  const pick = <T>(list: readonly T[]) => list[Math.floor(Math.random() * list.length)] as T;
  if (pool.length) return pick(pool);
  const base = pick(AGENT_NAMES);
  for (let i = 2; ; i++) if (!taken.has(`${base} ${i}`.toLowerCase())) return `${base} ${i}`;
}

/** What a pairing QR carries: the core's addresses a device may reach, the one-time code and, maybe, the chat to open. */
export function pairingLink(p: { code: string; urls: readonly string[]; thread?: string }): string {
  const q = new URLSearchParams([["c", p.code], ...p.urls.map((u) => ["u", u] as [string, string])]);
  if (p.thread) q.set("t", p.thread);
  return `apx://pair?${q.toString()}`;
}

/** Most a widget's state may hold, as JSON characters. */
export const SURFACE_STATE_MAX = 64_000;

/**
 * An artifact's file name ends in this, widget or app alike (the kind is in its manifest). `.apxapp` and `.apxext` are
 * kept for the marketplace's packaged apps and extensions. See DECISIONS.md#d-118.
 */
export const ARTIFACT_FILE_EXT = ".apxart";
