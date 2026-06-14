// APX mascot — "Roby", a little terminal critter that shows up across the CLI.
// Usage: import { mascot } from '#core/mascot.js'; mascot('happy');
//
// Same character as the web Splash/404 ("Roby"): a chunky ▄███████▄ head with
// two screen-eyes and a tiny mouth. Rendered as clean emerald-green line art on
// the terminal's own background — no heavy black-on-white blocks, no stray legs.
// Kept deliberately simple and a touch hand-made, not a photoreal sprite.

const R = "\x1b[0m";
const B = "\x1b[1m";
const DI = "\x1b[2m";

// Honor NO_COLOR; otherwise tint in emerald to match the web Roby (text-emerald).
const NO_COLOR = !!process.env.NO_COLOR;
const truecolor = /truecolor|24bit/i.test(process.env.COLORTERM || "");

function rgb(r, g, b) {
  if (NO_COLOR) return "";
  if (truecolor) return `\x1b[38;2;${r};${g};${b}m`;
  // 6x6x6 cube fallback for 256-color terminals.
  const q = (v) => Math.round((v / 255) * 5);
  return `\x1b[38;5;${16 + 36 * q(r) + 6 * q(g) + q(b)}m`;
}

// Two emerald tones: a bright frame and a dimmer "screen" green for the eyes,
// so the face reads without resorting to a second background colour.
const G = rgb(52, 211, 153);   // emerald-400 — frame, mouth, pupils
const GD = rgb(20, 120, 92);   // dim emerald — recessed eye screens
const reset = NO_COLOR ? "" : R;
const bold = NO_COLOR ? "" : B;
const dim = NO_COLOR ? "" : DI;

// Caption colours per mood (still emerald-family, just a nudge of hue).
const C_OK = rgb(52, 211, 153);
const C_INFO = rgb(94, 198, 255);
const C_WARN = rgb(240, 200, 90);
const C_BAD = rgb(240, 110, 110);

// Build Roby's head. `eyes` is [left, right] pupils; `mouth` is one glyph;
// `top` is an optional floating accent that hovers over the head.
function buildRoby({ eyes, mouth, top = "" }) {
  const [el, er] = eyes;
  const lines = [];
  lines.push(top ? `      ${dim}${top}${reset}` : "");
  lines.push(`   ${G}▄███████▄${reset}`);
  // Eye screens: dim ██ sockets set into the bright frame.
  lines.push(`  ${G}█ ${GD}██${G}   ${GD}██${G} █${reset}`);
  // Pupils + mouth, each a single green run (clean, no inline colour breaks).
  lines.push(`  ${G}█  ${el}   ${er}  █${reset}`);
  lines.push(`  ${G}█    ${mouth}    █${reset}`);
  lines.push(`   ${G}▀███████▀${reset}`);
  return lines.filter((l, i) => !(i === 0 && l === ""));
}

const MOODS = {
  // ─── happy: default greeting / daemon started ────────────────────────────
  happy: {
    caption: "ready to go!",
    color: C_OK,
    lines: buildRoby({ eyes: ["◕", "◕"], mouth: "‿" }),
  },

  // ─── wave: first run / setup ─────────────────────────────────────────────
  wave: {
    caption: "APX — Agent Project Context",
    color: C_OK,
    lines: buildRoby({ eyes: ["◕", "◕"], mouth: "▽", top: "·" }),
  },

  // ─── confused: unknown command / not found (the web 404 "lost" Roby) ──────
  confused: {
    caption: "hmm, I don't know that one",
    color: C_WARN,
    lines: buildRoby({ eyes: ["◑", "◐"], mouth: "o", top: "?" }),
  },

  // ─── sad: error ───────────────────────────────────────────────────────────
  sad: {
    caption: "something went wrong",
    color: C_BAD,
    lines: buildRoby({ eyes: ["╥", "╥"], mouth: "︵" }),
  },

  // ─── excited: update available ────────────────────────────────────────────
  excited: {
    caption: "new version available!",
    color: C_INFO,
    lines: buildRoby({ eyes: ["★", "★"], mouth: "▽", top: "✦" }),
  },

  // ─── sleeping: daemon not running ────────────────────────────────────────
  sleeping: {
    caption: "daemon is not running",
    color: rgb(150, 150, 150),
    lines: buildRoby({ eyes: ["−", "−"], mouth: "‿", top: "z z" }),
  },
};

// Print the mascot to stderr (doesn't interfere with piped stdout).
// mood: 'happy' | 'wave' | 'confused' | 'sad' | 'excited' | 'sleeping'
export function mascot(mood = "happy", message = "") {
  const def = MOODS[mood] || MOODS.happy;
  const out = [
    "",
    ...def.lines,
    "",
    `   ${def.color}${bold}${def.caption}${reset}`,
    message ? `   ${dim}${message}${reset}` : "",
    "",
  ]
    .filter((l, i, a) => !(l === "" && a[i - 1] === ""))
    .join("\n");
  process.stderr.write(out + "\n");
}

// One-liner for inline use: mascot.confused("apx: unknown command: foo")
mascot.confused = (msg) => mascot("confused", msg);
mascot.sad = (msg) => mascot("sad", msg);
mascot.happy = (msg) => mascot("happy", msg);
mascot.wave = (msg) => mascot("wave", msg);
mascot.excited = (msg) => mascot("excited", msg);
mascot.sleeping = (msg) => mascot("sleeping", msg);
